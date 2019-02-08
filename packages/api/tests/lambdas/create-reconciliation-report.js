'use strict';

const pMap = require('p-map');
const test = require('ava');
const moment = require('moment');
const { promisify } = require('util');
const chunk = require('lodash.chunk');
const flatten = require('lodash.flatten');
const range = require('lodash.range');
const sample = require('lodash.sample');
const sortBy = require('lodash.sortby');
const sinon = require('sinon');
const { CMR } = require('@cumulus/cmrjs');
const { aws, constructCollectionId } = require('@cumulus/common');
const { randomString } = require('@cumulus/common/test-utils');
const { sleep } = require('@cumulus/common/util');

const { handler } = require('../../lambdas/create-reconciliation-report');
const models = require('../../models');

const createBucket = (Bucket) => aws.s3().createBucket({ Bucket }).promise();
const promisifiedHandler = promisify(handler);

function storeBucketsConfigToS3(buckets, systemBucket, stackName) {
  const bucketsConfig = {};
  buckets.forEach((bucket) => {
    bucketsConfig[bucket] = {
      name: bucket,
      type: 'protected'
    };
  });
  return aws.s3().putObject({
    Bucket: systemBucket,
    Key: `${stackName}/workflows/buckets.json`,
    Body: JSON.stringify(bucketsConfig)
  }).promise();
}

// Expect files to have bucket and key properties
function storeFilesToS3(files) {
  const putObjectParams = files.map((file) => ({
    Bucket: file.bucket,
    Key: file.key,
    Body: randomString()
  }));

  return pMap(
    putObjectParams,
    (params) => aws.s3().putObject(params).promise(),
    { concurrency: 10 }
  );
}

// Expect files to have bucket, key, and granuleId properties
function storeFilesToDynamoDb(filesTableName, files) {
  const putRequests = files.map((file) => ({
    PutRequest: {
      Item: {
        bucket: { S: file.bucket },
        key: { S: file.key },
        granuleId: { S: file.granuleId }
      }
    }
  }));

  // Break the requests into groups of 25
  const putRequestsChunks = chunk(putRequests, 25);

  const putRequestParams = putRequestsChunks.map((requests) => ({
    RequestItems: {
      [filesTableName]: requests
    }
  }));

  return pMap(
    putRequestParams,
    (params) => aws.dynamodb().batchWriteItem(params).promise(),
    { concurrency: 1 }
  );
}

function storeCollectionsToDynamoDb(tableName, collections) {
  const putRequests = collections.map((collection) => ({
    PutRequest: {
      Item: {
        name: { S: collection.name },
        version: { S: collection.version }
      }
    }
  }));

  // Break the requests into groups of 25
  const putRequestsChunks = chunk(putRequests, 25);

  const putRequestParams = putRequestsChunks.map((requests) => ({
    RequestItems: {
      [tableName]: requests
    }
  }));

  return pMap(
    putRequestParams,
    (params) => aws.dynamodb().batchWriteItem(params).promise(),
    { concurrency: 1 }
  );
}

async function fetchCompletedReport(Bucket, stackName) {
  const Prefix = `${stackName}/reconciliation-reports/`;

  const report = await aws.s3().listObjectsV2({ Bucket, Prefix }).promise()
    .then((response) => response.Contents[0].Key)
    .then((Key) => aws.s3().getObject({ Bucket, Key }).promise())
    .then((response) => response.Body.toString())
    .then(JSON.parse);

  if (report.status === 'RUNNING') {
    return sleep(1000)
      .then(() => fetchCompletedReport(Bucket, stackName));
  }

  return report;
}

test.beforeEach(async (t) => {
  process.env.CollectionsTable = randomString();
  process.env.FilesTable = randomString();
  t.context.bucketsToCleanup = [];
  t.context.tablesToCleanup = [];

  t.context.stackName = randomString();
  t.context.systemBucket = randomString();

  await aws.s3().createBucket({ Bucket: t.context.systemBucket }).promise()
    .then(() => t.context.bucketsToCleanup.push(t.context.systemBucket));

  await new models.Collection().createTable();
  t.context.tablesToCleanup.push(process.env.CollectionsTable);

  await new models.FileClass().createTable();
  t.context.tablesToCleanup.push(process.env.FilesTable);

  sinon.stub(CMR.prototype, 'searchCollections').callsFake(() => []);
});

test.afterEach.always((t) => {
  Promise.all(flatten([
    t.context.bucketsToCleanup.map(aws.recursivelyDeleteS3Bucket),
    t.context.tablesToCleanup.map((TableName) =>
      models.Manager.deleteTable(TableName))
  ]));
  CMR.prototype.searchCollections.restore();
});

test.serial('A valid reconciliation report is generated for no buckets', async (t) => {
  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    [],
    t.context.systemBucket,
    t.context.stackName
  );

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName
  };
  await promisifiedHandler(event, {});

  const report = await fetchCompletedReport(t.context.systemBucket, t.context.stackName);
  const filesInCumulus = report.filesInCumulus;

  t.is(report.status, 'SUCCESS');
  t.is(report.error, null);
  t.is(filesInCumulus.okFileCount, 0);
  t.is(filesInCumulus.onlyInS3.length, 0);
  t.is(filesInCumulus.onlyInDynamoDb.length, 0);

  const reportStartTime = moment(report.reportStartTime);
  const reportEndTime = moment(report.reportEndTime);
  t.true(reportStartTime <= reportEndTime);
});

test.serial('A valid reconciliation report is generated when everything is in sync', async (t) => {
  const dataBuckets = range(2).map(() => randomString());
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  // Create random files
  const files = range(10).map((i) => ({
    bucket: dataBuckets[i % dataBuckets.length],
    key: randomString(),
    granuleId: randomString()
  }));

  // Store the files to S3 and DynamoDB
  await Promise.all([
    storeFilesToS3(files),
    storeFilesToDynamoDb(process.env.FilesTable, files)
  ]);

  // Create collections that are in sync
  const matchingColls = range(10).map(() => ({
    name: randomString(),
    version: randomString()
  }));

  const cmrCollections = sortBy(matchingColls, ['name', 'version'])
    .map((collection) => ({
      umm: { ShortName: collection.name, Version: collection.version }
    }));

  CMR.prototype.searchCollections.restore();
  sinon.stub(CMR.prototype, 'searchCollections').callsFake(() => cmrCollections);

  await storeCollectionsToDynamoDb(
    process.env.CollectionsTable,
    sortBy(matchingColls, ['name', 'version'])
  );

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName
  };
  await promisifiedHandler(event, {});

  const report = await fetchCompletedReport(t.context.systemBucket, t.context.stackName);
  const filesInCumulus = report.filesInCumulus;
  const collectionsInCumulusCmr = report.collectionsInCumulusCmr;

  t.is(report.status, 'SUCCESS');
  t.is(report.error, null);
  t.is(filesInCumulus.okFileCount, files.length);
  t.is(filesInCumulus.onlyInS3.length, 0);
  t.is(filesInCumulus.onlyInDynamoDb.length, 0);
  t.is(collectionsInCumulusCmr.okCollectionCount, matchingColls.length);
  t.is(collectionsInCumulusCmr.onlyInCumulus.length, 0);
  t.is(collectionsInCumulusCmr.onlyInCmr.length, 0);

  const reportStartTime = moment(report.reportStartTime);
  const reportEndTime = moment(report.reportEndTime);
  t.true(reportStartTime <= reportEndTime);
});

test.serial('A valid reconciliation report is generated when there are extra S3 objects', async (t) => {
  const dataBuckets = range(2).map(() => randomString());
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  // Create files that are in sync
  const matchingFiles = range(10).map(() => ({
    bucket: sample(dataBuckets),
    key: randomString(),
    granuleId: randomString()
  }));

  const extraS3File1 = { bucket: sample(dataBuckets), key: randomString() };
  const extraS3File2 = { bucket: sample(dataBuckets), key: randomString() };

  // Store the files to S3 and DynamoDB
  await storeFilesToS3(matchingFiles.concat([extraS3File1, extraS3File2]));
  await storeFilesToDynamoDb(process.env.FilesTable, matchingFiles);

  const event = {
    dataBuckets,
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName
  };
  await promisifiedHandler(event, {});

  const report = await fetchCompletedReport(t.context.systemBucket, t.context.stackName);
  const filesInCumulus = report.filesInCumulus;

  t.is(report.status, 'SUCCESS');
  t.is(report.error, null);
  t.is(filesInCumulus.okFileCount, matchingFiles.length);

  t.is(filesInCumulus.onlyInS3.length, 2);
  t.true(filesInCumulus.onlyInS3.includes(aws.buildS3Uri(extraS3File1.bucket, extraS3File1.key)));
  t.true(filesInCumulus.onlyInS3.includes(aws.buildS3Uri(extraS3File2.bucket, extraS3File2.key)));

  t.is(filesInCumulus.onlyInDynamoDb.length, 0);

  const reportStartTime = moment(report.reportStartTime);
  const reportEndTime = moment(report.reportEndTime);
  t.true(reportStartTime <= reportEndTime);
});

test.serial('A valid reconciliation report is generated when there are extra DynamoDB objects', async (t) => {
  const dataBuckets = range(2).map(() => randomString());
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  // Create files that are in sync
  const matchingFiles = range(10).map(() => ({
    bucket: sample(dataBuckets),
    key: randomString(),
    granuleId: randomString()
  }));

  const extraDbFile1 = {
    bucket: sample(dataBuckets),
    key: randomString(),
    granuleId: randomString()
  };
  const extraDbFile2 = {
    bucket: sample(dataBuckets),
    key: randomString(),
    granuleId: randomString()
  };

  // Store the files to S3 and DynamoDB
  await storeFilesToS3(matchingFiles);
  await storeFilesToDynamoDb(
    process.env.FilesTable,
    matchingFiles.concat([extraDbFile1, extraDbFile2])
  );

  const event = {
    dataBuckets,
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName
  };
  await promisifiedHandler(event, {});

  const report = await fetchCompletedReport(t.context.systemBucket, t.context.stackName);
  const filesInCumulus = report.filesInCumulus;

  t.is(report.status, 'SUCCESS');
  t.is(report.error, null);
  t.is(filesInCumulus.okFileCount, matchingFiles.length);
  t.is(filesInCumulus.onlyInS3.length, 0);

  t.is(filesInCumulus.onlyInDynamoDb.length, 2);
  t.truthy(filesInCumulus.onlyInDynamoDb.find((f) =>
    f.uri === aws.buildS3Uri(extraDbFile1.bucket, extraDbFile1.key)
    && f.granuleId === extraDbFile1.granuleId));
  t.truthy(filesInCumulus.onlyInDynamoDb.find((f) =>
    f.uri === aws.buildS3Uri(extraDbFile2.bucket, extraDbFile2.key)
    && f.granuleId === extraDbFile2.granuleId));

  const reportStartTime = moment(report.reportStartTime);
  const reportEndTime = moment(report.reportEndTime);
  t.true(reportStartTime <= reportEndTime);
});

test.serial('A valid reconciliation report is generated when there are both extra DynamoDB and extra S3 files', async (t) => {
  const dataBuckets = range(2).map(() => randomString());
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  // Create files that are in sync
  const matchingFiles = range(10).map(() => ({
    bucket: sample(dataBuckets),
    key: randomString(),
    granuleId: randomString()
  }));

  const extraS3File1 = { bucket: sample(dataBuckets), key: randomString() };
  const extraS3File2 = { bucket: sample(dataBuckets), key: randomString() };
  const extraDbFile1 = {
    bucket: sample(dataBuckets),
    key: randomString(),
    granuleId: randomString()
  };
  const extraDbFile2 = {
    bucket: sample(dataBuckets),
    key: randomString(),
    granuleId: randomString()
  };

  // Store the files to S3 and DynamoDB
  await storeFilesToS3(matchingFiles.concat([extraS3File1, extraS3File2]));
  await storeFilesToDynamoDb(
    process.env.FilesTable,
    matchingFiles.concat([extraDbFile1, extraDbFile2])
  );

  const event = {
    dataBuckets,
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName
  };
  await promisifiedHandler(event, {});

  const report = await fetchCompletedReport(t.context.systemBucket, t.context.stackName);
  const filesInCumulus = report.filesInCumulus;

  t.is(report.status, 'SUCCESS');
  t.is(report.error, null);
  t.is(filesInCumulus.okFileCount, matchingFiles.length);

  t.is(filesInCumulus.onlyInS3.length, 2);
  t.true(filesInCumulus.onlyInS3.includes(aws.buildS3Uri(extraS3File1.bucket, extraS3File1.key)));
  t.true(filesInCumulus.onlyInS3.includes(aws.buildS3Uri(extraS3File2.bucket, extraS3File2.key)));

  t.is(filesInCumulus.onlyInDynamoDb.length, 2);
  t.truthy(filesInCumulus.onlyInDynamoDb.find((f) =>
    f.uri === aws.buildS3Uri(extraDbFile1.bucket, extraDbFile1.key)
    && f.granuleId === extraDbFile1.granuleId));
  t.truthy(filesInCumulus.onlyInDynamoDb.find((f) =>
    f.uri === aws.buildS3Uri(extraDbFile2.bucket, extraDbFile2.key)
    && f.granuleId === extraDbFile2.granuleId));

  const reportStartTime = moment(report.reportStartTime);
  const reportEndTime = moment(report.reportEndTime);
  t.true(reportStartTime <= reportEndTime);
});

test.serial('A valid reconciliation report is generated when there are both extra DB and CMR collections', async (t) => {
  const dataBuckets = range(2).map(() => randomString());
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  // Create collections that are in sync
  const matchingColls = range(10).map(() => ({
    name: randomString(),
    version: randomString()
  }));

  const extraDbColls = range(2).map(() => ({
    name: randomString(),
    version: randomString()
  }));
  const extraCmrColls = range(2).map(() => ({
    name: randomString(),
    version: randomString()
  }));

  const cmrCollections = sortBy(matchingColls.concat(extraCmrColls), ['name', 'version'])
    .map((collection) => ({
      umm: { ShortName: collection.name, Version: collection.version }
    }));

  CMR.prototype.searchCollections.restore();
  sinon.stub(CMR.prototype, 'searchCollections').callsFake(() => cmrCollections);

  await storeCollectionsToDynamoDb(
    process.env.CollectionsTable,
    sortBy(matchingColls.concat(extraDbColls), ['name', 'version'])
  );

  const event = {
    dataBuckets,
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName
  };
  await promisifiedHandler(event, {});

  const report = await fetchCompletedReport(t.context.systemBucket, t.context.stackName);
  const collectionsInCumulusCmr = report.collectionsInCumulusCmr;

  t.is(report.status, 'SUCCESS');
  t.is(report.error, null);
  t.is(collectionsInCumulusCmr.okCollectionCount, matchingColls.length);

  t.is(collectionsInCumulusCmr.onlyInCumulus.length, 2);
  extraDbColls.map((collection) =>
    t.true(collectionsInCumulusCmr.onlyInCumulus
      .includes(constructCollectionId(collection.name, collection.version))));

  t.is(collectionsInCumulusCmr.onlyInCmr.length, 2);
  extraCmrColls.map((collection) =>
    t.true(collectionsInCumulusCmr.onlyInCmr
      .includes(constructCollectionId(collection.name, collection.version))));

  const reportStartTime = moment(report.reportStartTime);
  const reportEndTime = moment(report.reportEndTime);
  t.true(reportStartTime <= reportEndTime);
});

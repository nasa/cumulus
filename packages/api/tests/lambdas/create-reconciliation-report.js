'use strict';

const test = require('ava');
const moment = require('moment');
const { TaskQueue } = require('cwait');
const { promisify } = require('util');
const chunk = require('lodash.chunk');
const flatten = require('lodash.flatten');
const range = require('lodash.range');
const sample = require('lodash.sample');
const {
  aws,
  testUtils: {
    randomString
  }
} = require('@cumulus/common');
const { handler } = require('../../lambdas/create-reconciliation-report');
const models = require('../../models');

const createBucket = (Bucket) => aws.s3().createBucket({ Bucket }).promise();
const promisifiedBatchWriteItem = (params) => aws.dynamodb().batchWriteItem(params).promise();
const promisifiedHandler = promisify(handler);
const promisifiedSetTimeout = promisify(setTimeout);

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
  const putObjectQueue = new TaskQueue(Promise, 10);
  const promisifiedPutObject = (params) => aws.s3().putObject(params).promise();
  const throttledPutObject = putObjectQueue.wrap(promisifiedPutObject);

  return Promise.all(files.map((file) => throttledPutObject({
    Bucket: file.bucket,
    Key: file.key,
    Body: randomString()
  })));
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

  const batchWriteItemQueue = new TaskQueue(Promise, 1);
  const throttledBatchWriteItem = batchWriteItemQueue.wrap(promisifiedBatchWriteItem);

  return Promise.all(putRequestsChunks.map((requests) => {
    const params = { RequestItems: {} };
    params.RequestItems[filesTableName] = requests;

    return throttledBatchWriteItem(params);
  }));
}

async function fetchCompletedReport(Bucket, stackName) {
  const Prefix = `${stackName}/reconciliation-reports/`;

  const report = await aws.s3().listObjectsV2({ Bucket, Prefix }).promise()
    .then((response) => response.Contents[0].Key)
    .then((Key) => aws.s3().getObject({ Bucket, Key }).promise())
    .then((response) => response.Body.toString())
    .then(JSON.parse);

  if (report.status === 'RUNNING') {
    return promisifiedSetTimeout(1000)
      .then(() => fetchCompletedReport(Bucket, stackName));
  }

  return report;
}

test.beforeEach(async (t) => {
  t.context.bucketsToCleanup = [];
  t.context.tablesToCleanup = [];

  t.context.stackName = randomString();
  t.context.systemBucket = randomString();
  t.context.filesTableName = randomString();

  const filesTableParams = {
    TableName: t.context.filesTableName,
    AttributeDefinitions: [
      { AttributeName: 'bucket', AttributeType: 'S' },
      { AttributeName: 'key', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'bucket', KeyType: 'HASH' },
      { AttributeName: 'key', KeyType: 'RANGE' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  await aws.s3().createBucket({ Bucket: t.context.systemBucket }).promise()
    .then(() => t.context.bucketsToCleanup.push(t.context.systemBucket));
  await aws.dynamodb().createTable(filesTableParams).promise()
    .then(() => aws.dynamodb().waitFor('tableExists', { TableName: t.context.filesTableName }).promise())
    .then(() => t.context.tablesToCleanup.push(t.context.filesTableName));
});

test.afterEach.always((t) =>
  Promise.all(flatten([
    t.context.bucketsToCleanup.map(aws.recursivelyDeleteS3Bucket),
    t.context.tablesToCleanup.map((TableName) =>
      models.Manager.deleteTable(TableName))
  ])));

test.serial('A valid reconciliation report is generated for no buckets', async (t) => {
  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    [],
    t.context.systemBucket,
    t.context.stackName
  );

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    filesTableName: t.context.filesTableName
  };
  await promisifiedHandler(event, {});

  const report = await fetchCompletedReport(t.context.systemBucket, t.context.stackName);

  t.is(report.status, 'SUCCESS');
  t.is(report.error, null);
  t.is(report.okFileCount, 0);
  t.is(report.onlyInS3.length, 0);
  t.is(report.onlyInDynamoDb.length, 0);

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
    storeFilesToDynamoDb(t.context.filesTableName, files)
  ]);

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    filesTableName: t.context.filesTableName
  };
  await promisifiedHandler(event, {});

  const report = await fetchCompletedReport(t.context.systemBucket, t.context.stackName);

  t.is(report.status, 'SUCCESS');
  t.is(report.error, null);
  t.is(report.okFileCount, files.length);
  t.is(report.onlyInS3.length, 0);
  t.is(report.onlyInDynamoDb.length, 0);

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
  await storeFilesToDynamoDb(t.context.filesTableName, matchingFiles);

  const event = {
    dataBuckets,
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    filesTableName: t.context.filesTableName
  };
  await promisifiedHandler(event, {});

  const report = await fetchCompletedReport(t.context.systemBucket, t.context.stackName);

  t.is(report.status, 'SUCCESS');
  t.is(report.error, null);
  t.is(report.okFileCount, matchingFiles.length);

  t.is(report.onlyInS3.length, 2);
  t.true(report.onlyInS3.includes(aws.buildS3Uri(extraS3File1.bucket, extraS3File1.key)));
  t.true(report.onlyInS3.includes(aws.buildS3Uri(extraS3File2.bucket, extraS3File2.key)));

  t.is(report.onlyInDynamoDb.length, 0);

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

  const extraDbFile1 = { bucket: sample(dataBuckets), key: randomString(), granuleId: randomString() };
  const extraDbFile2 = { bucket: sample(dataBuckets), key: randomString(), granuleId: randomString() };

  // Store the files to S3 and DynamoDB
  await storeFilesToS3(matchingFiles);
  await storeFilesToDynamoDb(t.context.filesTableName, matchingFiles.concat([extraDbFile1, extraDbFile2]));

  const event = {
    dataBuckets,
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    filesTableName: t.context.filesTableName
  };
  await promisifiedHandler(event, {});

  const report = await fetchCompletedReport(t.context.systemBucket, t.context.stackName);

  t.is(report.status, 'SUCCESS');
  t.is(report.error, null);
  t.is(report.okFileCount, matchingFiles.length);
  t.is(report.onlyInS3.length, 0);

  t.is(report.onlyInDynamoDb.length, 2);
  t.truthy(report.onlyInDynamoDb.find((f) =>
    f.uri === aws.buildS3Uri(extraDbFile1.bucket, extraDbFile1.key)
    && f.granuleId === extraDbFile1.granuleId));
  t.truthy(report.onlyInDynamoDb.find((f) =>
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
  const extraDbFile1 = { bucket: sample(dataBuckets), key: randomString(), granuleId: randomString() };
  const extraDbFile2 = { bucket: sample(dataBuckets), key: randomString(), granuleId: randomString() };

  // Store the files to S3 and DynamoDB
  await storeFilesToS3(matchingFiles.concat([extraS3File1, extraS3File2]));
  await storeFilesToDynamoDb(t.context.filesTableName, matchingFiles.concat([extraDbFile1, extraDbFile2]));

  const event = {
    dataBuckets,
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    filesTableName: t.context.filesTableName
  };
  await promisifiedHandler(event, {});

  const report = await fetchCompletedReport(t.context.systemBucket, t.context.stackName);

  t.is(report.status, 'SUCCESS');
  t.is(report.error, null);
  t.is(report.okFileCount, matchingFiles.length);

  t.is(report.onlyInS3.length, 2);
  t.true(report.onlyInS3.includes(aws.buildS3Uri(extraS3File1.bucket, extraS3File1.key)));
  t.true(report.onlyInS3.includes(aws.buildS3Uri(extraS3File2.bucket, extraS3File2.key)));

  t.is(report.onlyInDynamoDb.length, 2);
  t.truthy(report.onlyInDynamoDb.find((f) =>
    f.uri === aws.buildS3Uri(extraDbFile1.bucket, extraDbFile1.key)
    && f.granuleId === extraDbFile1.granuleId));
  t.truthy(report.onlyInDynamoDb.find((f) =>
    f.uri === aws.buildS3Uri(extraDbFile2.bucket, extraDbFile2.key)
    && f.granuleId === extraDbFile2.granuleId));

  const reportStartTime = moment(report.reportStartTime);
  const reportEndTime = moment(report.reportEndTime);
  t.true(reportStartTime <= reportEndTime);
});

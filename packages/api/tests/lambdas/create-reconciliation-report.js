'use strict';

const pMap = require('p-map');
const test = require('ava');
const moment = require('moment');
const { promisify } = require('util');
const chunk = require('lodash.chunk');
const flatten = require('lodash.flatten');
const map = require('lodash.map');
const range = require('lodash.range');
const sample = require('lodash.sample');
const sortBy = require('lodash.sortby');
const sinon = require('sinon');
const { CMR, CMRSearchConceptQueue } = require('@cumulus/cmrjs');
const { aws, BucketsConfig, constructCollectionId } = require('@cumulus/common');
const { randomString } = require('@cumulus/common/test-utils');
const { sleep } = require('@cumulus/common/util');
const { fakeGranuleFactoryV2 } = require('../../lib/testUtils');

const {
  handler, reconciliationReportForGranules, reconciliationReportForGranuleFiles
} = require('../../lambdas/create-reconciliation-report');

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

/**
 * store data to database
 *
 * @param {string} tableName table name to store data
 * @param {Array<Object>} putRequests list of put requests
 * @returns {undefined} promise of the store requests
 */
function storeToDynamoDb(tableName, putRequests) {
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

// Expect files to have bucket, key, and granuleId properties
function storeFilesToDynamoDb(tableName, files) {
  const putRequests = files.map((file) => ({
    PutRequest: {
      Item: {
        bucket: { S: file.bucket },
        key: { S: file.key },
        granuleId: { S: file.granuleId }
      }
    }
  }));

  return storeToDynamoDb(tableName, putRequests);
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

  return storeToDynamoDb(tableName, putRequests);
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
  process.env.GranulesTable = randomString();
  process.env.FilesTable = randomString();

  t.context.bucketsToCleanup = [];
  t.context.stackName = randomString();
  t.context.systemBucket = randomString();

  await aws.s3().createBucket({ Bucket: t.context.systemBucket }).promise()
    .then(() => t.context.bucketsToCleanup.push(t.context.systemBucket));

  await new models.Collection().createTable();
  await new models.Granule().createTable();
  await new models.FileClass().createTable();

  sinon.stub(CMR.prototype, 'searchCollections').callsFake(() => []);
  sinon.stub(CMRSearchConceptQueue.prototype, 'peek').callsFake(() => null);
  sinon.stub(CMRSearchConceptQueue.prototype, 'shift').callsFake(() => null);
});

test.afterEach.always((t) => {
  Promise.all(flatten([
    t.context.bucketsToCleanup.map(aws.recursivelyDeleteS3Bucket),
    new models.Collection().deleteTable(),
    new models.Granule().deleteTable(),
    new models.FileClass().deleteTable()
  ]));
  CMR.prototype.searchCollections.restore();
  CMRSearchConceptQueue.prototype.peek.restore();
  CMRSearchConceptQueue.prototype.shift.restore();
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
  t.is(filesInCumulus.okCount, 0);
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
  t.is(filesInCumulus.okCount, files.length);
  t.is(filesInCumulus.onlyInS3.length, 0);
  t.is(filesInCumulus.onlyInDynamoDb.length, 0);
  t.is(collectionsInCumulusCmr.okCount, matchingColls.length);
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
  t.is(filesInCumulus.okCount, matchingFiles.length);

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
  t.is(filesInCumulus.okCount, matchingFiles.length);
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
  t.is(filesInCumulus.okCount, matchingFiles.length);

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
  t.is(collectionsInCumulusCmr.okCount, matchingColls.length);

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

test.serial('reconciliationReportForGranules reports discrepancy of granule holdings in CUMULUS and CMR', async (t) => {
  const shortName = randomString();
  const version = randomString();
  const collectionId = constructCollectionId(shortName, version);

  // create granules that are in sync
  const matchingGrans = range(10).map(() =>
    fakeGranuleFactoryV2({ collectionId: collectionId, status: 'completed', files: [] }));

  const extraDbGrans = range(2).map(() =>
    fakeGranuleFactoryV2({ collectionId: collectionId, status: 'completed', files: [] }));

  const extraCmrGrans = range(2).map(() => ({
    granuleId: randomString(),
    collectionId: collectionId
  }));

  const cmrGranules = sortBy(matchingGrans.concat(extraCmrGrans), ['granuleId']).map((granule) => ({
    umm: {
      GranuleUR: granule.granuleId,
      CollectionReference: { ShortName: shortName, Version: version },
      RelatedUrls: []
    }
  }));

  CMRSearchConceptQueue.prototype.peek.restore();
  CMRSearchConceptQueue.prototype.shift.restore();
  sinon.stub(CMRSearchConceptQueue.prototype, 'peek').callsFake(() => cmrGranules[0]);
  sinon.stub(CMRSearchConceptQueue.prototype, 'shift').callsFake(() => cmrGranules.shift());

  await new models.Granule().create(matchingGrans.concat(extraDbGrans));

  const { granulesReport, filesReport } = await
  reconciliationReportForGranules(collectionId, new BucketsConfig({}));

  t.is(granulesReport.okCount, 10);

  const expectedOnlyInCumulus = sortBy(extraDbGrans, ['granuleId']).map((gran) =>
    ({ granuleId: gran.granuleId, collectionId: gran.collectionId }));
  t.deepEqual(granulesReport.onlyInCumulus, expectedOnlyInCumulus);

  t.deepEqual(granulesReport.onlyInCmr.map((gran) => gran.GranuleUR),
    extraCmrGrans.map((gran) => gran.granuleId).sort());

  t.is(filesReport.okCount, 0);
  t.is(filesReport.onlyInCumulus.length, 0);
  t.is(filesReport.onlyInCmr.length, 0);
});

test.serial('reconciliationReportForGranuleFiles reports discrepancy of granule file holdings in CUMULUS and CMR', async (t) => {
  process.env.DISTRIBUTION_ENDPOINT = 'https://example.com/';
  const buckets = {
    internal: { name: 'cumulus-test-sandbox-internal', type: 'internal' },
    private: { name: 'testbucket-private', type: 'private' },
    protected: { name: 'testbucket-protected', type: 'protected' },
    public: { name: 'testbucket-public', type: 'public' },
    'protected-2': { name: 'testbucket-protected-2', type: 'protected' }
  };
  const bucketsConfig = new BucketsConfig(buckets);

  const matchingFilesInDb = [{
    bucket: 'testbucket-protected',
    key: 'MOD09GQ___006/2017/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf',
    fileSize: 17865615,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf'
  },
  {
    bucket: 'testbucket-public',
    key: 'MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190_ndvi.jpg',
    fileSize: 44118,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190_ndvi.jpg'
  },
  {
    bucket: 'testbucket-protected-2',
    key: 'MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.cmr.xml',
    fileSize: 2708,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190.cmr.xml'
  }];

  const privateFilesInDb = [{
    bucket: 'testbucket-private',
    key: 'MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf.met',
    fileSize: 44118,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf.met'
  }];

  const filesOnlyInDb = [{
    bucket: 'testbucket-public',
    key: 'MOD09GQ___006/MOD/extra123.jpg',
    fileSize: 44118,
    fileName: 'extra123.jpg'
  },
  {
    bucket: 'testbucket-protected',
    key: 'MOD09GQ___006/MOD/extra456.jpg',
    fileSize: 44118,
    fileName: 'extra456.jpg'
  }];

  const granInDb = {
    granuleId: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190',
    collectionId: 'MOD09GQ___006',
    files: matchingFilesInDb.concat(privateFilesInDb).concat(filesOnlyInDb)
  };

  const matchingFilesInCmr = [{
    URL: 'https://example.com/testbucket-protected/MOD09GQ___006/2017/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf',
    Type: 'GET DATA',
    Description: 'File to download'
  },
  {
    URL: 'https://testbucket-public.s3.amazonaws.com/MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190_ndvi.jpg',
    Type: 'GET DATA',
    Description: 'File to download'
  },
  {
    URL: 'https://example.com/testbucket-protected-2/MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.cmr.xml',
    Type: 'GET DATA',
    Description: 'File to download'
  }];

  const filesOnlyInCmr = [{
    URL: 'https://enjo7p7os7.execute-api.us-east-1.amazonaws.com/dev/MYD13Q1.A2017297.h19v10.006.2017313221202.hdf',
    Type: 'GET DATA',
    Description: 'File to download'
  }];

  const urlsShouldOnlyInCmr = [{
    URL: 'https://example.com/s3credentials',
    Type: 'VIEW RELATED INFORMATION',
    Description: 'api endpoint to retrieve temporary credentials valid for same-region direct s3 access'
  }];

  const granInCmr = {
    GranuleUR: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190',
    ShortName: 'MOD09GQ',
    Version: '006',
    RelatedUrls: matchingFilesInCmr.concat(filesOnlyInCmr).concat(urlsShouldOnlyInCmr)
  };

  const report = await reconciliationReportForGranuleFiles(granInDb, granInCmr, bucketsConfig);
  t.is(report.okCount, matchingFilesInDb.length + privateFilesInDb.length);

  t.is(report.onlyInCumulus.length, filesOnlyInDb.length);
  t.deepEqual(map(report.onlyInCumulus, 'fileName').sort(), map(filesOnlyInDb, 'fileName').sort());

  t.is(report.onlyInCmr.length, filesOnlyInCmr.length);
  t.deepEqual(map(report.onlyInCmr, 'URL').sort(), map(filesOnlyInCmr, 'URL').sort());
});

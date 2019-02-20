'use strict';

const fs = require('fs-extra');
const {
  aws: {
    buildS3Uri,
    deleteS3Files,
    dynamodb,
    lambda,
    s3
  },
  constructCollectionId,
  testUtils: {
    randomString
  }
} = require('@cumulus/common');

const {
  addCollections,
  addProviders,
  buildAndExecuteWorkflow,
  cleanupCollections,
  cleanupProviders,
  granulesApi: granulesApiTestUtils,
  waitForConceptExistsOutcome
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  uploadTestDataToBucket,
  deleteFolder,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix
} = require('../helpers/testUtils');
const { setupTestGranuleForIngest } = require('../helpers/granuleUtils');

const reportsPrefix = (stackName) => `${stackName}/reconciliation-reports/`;
const filesTableName = (stackName) => `${stackName}-FilesTable`;
const collectionsTableName = (stackName) => `${stackName}-CollectionsTable`;
const providersDir = './data/providers/s3/';
const collectionsDir = './data/collections/s3_MOD09GQ_006';

const config = loadConfig();

async function findProtectedBucket(systemBucket, stackName) {
  const bucketConfigs = await s3().getObject({
    Bucket: systemBucket,
    Key: `${stackName}/workflows/buckets.json`
  }).promise()
    .then((response) => response.Body.toString())
    .then((bucketsConfigString) => JSON.parse(bucketsConfigString))
    .then(Object.values);

  const protectedBucketConfig = bucketConfigs.find((bc) => bc.type === 'protected');
  if (!protectedBucketConfig) throw new Error(`Unable to find protected bucket in ${JSON.stringify(bucketConfigs)}`);

  return protectedBucketConfig.name;
}

function getReportsKeys(systemBucket, stackName) {
  return s3().listObjectsV2({
    Bucket: systemBucket,
    Prefix: reportsPrefix(stackName)
  }).promise()
    .then((response) => response.Contents.map((o) => o.Key));
}

async function deleteReconciliationReports(systemBucket, stackName) {
  const reportKeys = await getReportsKeys(systemBucket, stackName);

  const objectsToDelete = reportKeys.map((Key) => ({
    Bucket: systemBucket,
    Key
  }));

  return deleteS3Files(objectsToDelete);
}

// add MOD09GQ___006 collection, and ingest and publish a granule
async function ingestAndPublishGranule(testSuffix, testDataFolder) {
  const workflowName = 'IngestAndPublishGranule';
  const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

  const s3data = [
    '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
    '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
    '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg'
  ];

  const inputPayloadFilename = './spec/parallel/ingestGranule/IngestGranule.input.payload.json';
  const collection = { name: 'MOD09GQ', version: '006' };
  const provider = { id: `s3_provider${testSuffix}` };

  process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;

  // populate collections, providers and test data
  await Promise.all([
    uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
    addCollections(config.stackName, config.bucket, collectionsDir),
    addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix)
  ]);

  const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
  // update test data filepaths
  const inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, '', testDataFolder);

  await buildAndExecuteWorkflow(
    config.stackName, config.bucket, workflowName, collection, provider, inputPayload
  );

  const collectionId = constructCollectionId(collection.name, collection.version);
  return { granuleId: inputPayload.granules[0].granuleId, collectionId };
}

describe('When there are granule differences and granule reconciliation is run', () => {
  let report;
  let extraS3Object;
  let extraFileInDb;
  let extraCumulusCollection;
  let protectedBucket;
  let granuleId;
  let collectionId;
  let testDataFolder;
  let testSuffix;

  beforeAll(async () => {
    // Remove any pre-existing reconciliation reports
    await deleteReconciliationReports(config.bucket, config.stackName);

    // Find a protected bucket
    protectedBucket = await findProtectedBucket(config.bucket, config.stackName);

    // Write an extra S3 object to the protected bucket
    extraS3Object = { Bucket: protectedBucket, Key: randomString() };
    await s3().putObject(Object.assign({ Body: 'delete-me' }, extraS3Object)).promise();

    // Write an extra file to the DynamoDB Files table
    extraFileInDb = {
      bucket: { S: protectedBucket },
      key: { S: randomString() },
      granuleId: { S: randomString() }
    };

    await dynamodb().putItem({
      TableName: filesTableName(config.stackName),
      Item: extraFileInDb
    }).promise();

    // Write an extra collection to the Collections table
    extraCumulusCollection = {
      name: { S: randomString() },
      version: { S: randomString() }
    };

    await dynamodb().putItem({
      TableName: collectionsTableName(config.stackName),
      Item: extraCumulusCollection
    }).promise();

    const testId = createTimestampedTestId(config.stackName, 'CreateReconciliationReport');
    testSuffix = createTestSuffix(testId);
    testDataFolder = createTestDataPath(testId);

    const ingestedGranule = await ingestAndPublishGranule(testSuffix, testDataFolder);
    granuleId = ingestedGranule.granuleId;
    collectionId = ingestedGranule.collectionId;

    console.log(`invoke ${config.stackName}-CreateReconciliationReport`);

    // Run the report
    await lambda().invoke({ FunctionName: `${config.stackName}-CreateReconciliationReport` }).promise();

    // Fetch the report
    const reportKey = (await getReportsKeys(config.bucket, config.stackName))[0];
    report = await s3().getObject({
      Bucket: config.bucket,
      Key: reportKey
    }).promise()
      .then((response) => JSON.parse(response.Body.toString()));
  });

  it('generates a report showing cumulus files that are in S3 but not in the DynamoDB Files table', () => {
    const extraS3ObjectUri = buildS3Uri(extraS3Object.Bucket, extraS3Object.Key);
    expect(report.filesInCumulus.onlyInS3).toContain(extraS3ObjectUri);
  });

  it('generates a report showing cumulus files that are in the DynamoDB Files table but not in S3', () => {
    const extraFileUri = buildS3Uri(extraFileInDb.bucket.S, extraFileInDb.key.S);
    const extraDbUris = report.filesInCumulus.onlyInDynamoDb.map((i) => i.uri);
    expect(extraDbUris).toContain(extraFileUri);
  });

  it('generates a report showing number of collections that are in both Cumulus and CMR', () => {
    // MOD09GQ___006 is in both Cumulus and CMR
    expect(report.collectionsInCumulusCmr.okCollectionCount).toBeGreaterThan(0);
  });

  it('generates a report showing collections that are in the Cumulus but not in CMR', () => {
    const extraCollection = constructCollectionId(extraCumulusCollection.name.S, extraCumulusCollection.version.S);
    expect(report.collectionsInCumulusCmr.onlyInCumulus).toContain(extraCollection);
    expect(report.collectionsInCumulusCmr.onlyInCumulus).not.toContain(collectionId);
  });

  it('generates a report showing collections that are in the CMR but not in Cumulus', () => {
    // we know CMR has collections which are not in Cumulus
    expect(report.collectionsInCumulusCmr.onlyInCmr.length).toBeGreaterThan(0);
    expect(report.collectionsInCumulusCmr.onlyInCmr).not.toContain(collectionId);
  });

  it('generates a report showing number of granules that are in both Cumulus and CMR', () => {
    expect(report.granulesInCumulusCmr.okGranuleCount).toBeGreaterThan(0);
  });

  it('generates a report showing granules that are in the Cumulus but not in CMR', () => {
    expect(report.granulesInCumulusCmr.onlyInCumulus.map((gran) => gran.granuleId)).not.toContain(granuleId);
  });

  it('generates a report showing granules that are in the CMR but not in Cumulus', () => {
    // we know CMR has granules which are not in Cumulus (against current stack)
    expect(report.granulesInCumulusCmr.onlyInCmr.length).toBeGreaterThan(0);
    expect(report.granulesInCumulusCmr.onlyInCmr.map((gran) => gran.granuleId)).not.toContain(granuleId);
  });

  afterAll(async () => {
    await Promise.all([
      deleteReconciliationReports(config.bucket, config.stackName),
      s3().deleteObject(extraS3Object).promise(),
      dynamodb().deleteItem({
        TableName: filesTableName(config.stackName),
        Key: {
          bucket: extraFileInDb.bucket,
          key: extraFileInDb.key
        }
      }).promise(),
      dynamodb().deleteItem({
        TableName: collectionsTableName(config.stackName),
        Key: {
          name: extraCumulusCollection.name,
          version: extraCumulusCollection.version
        }
      }).promise(),
      deleteFolder(config.bucket, testDataFolder),
      cleanupCollections(config.stackName, config.bucket, collectionsDir),
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix)
    ]);

    const granuleResponse = await granulesApiTestUtils.getGranule({
      prefix: config.stackName,
      granuleId: granuleId
    });

    await granulesApiTestUtils.removeFromCMR({ prefix: config.stackName, granuleId: granuleId });
    await waitForConceptExistsOutcome(JSON.parse(granuleResponse.body).cmrLink, false);
    await granulesApiTestUtils.deleteGranule({ prefix: config.stackName, granuleId: granuleId });
  });
});

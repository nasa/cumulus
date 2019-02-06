'use strict';

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

const { loadConfig } = require('../helpers/testUtils');

const reportsPrefix = (stackName) => `${stackName}/reconciliation-reports/`;
const filesTableName = (stackName) => `${stackName}-FilesTable`;
const collectionsTableName = (stackName) => `${stackName}-CollectionsTable`;

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

describe('When there are granule differences and granule reconciliation is run', () => {
  let report;
  let extraS3Object;
  let extraFileInDb;
  let extraCumulusCollection;
  let protectedBucket;

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

  it('generates a report showing collections that are in the Cumulus but on in CMR', () => {
    const extraCollection = constructCollectionId(extraCumulusCollection.name.S, extraCumulusCollection.version.S);
    expect(report.collectionsInCumulusCmr.onlyInCumulus).toContain(extraCollection);
  });

  it('generates a report showing collections that are in the CMR but on in Cumulus', () => {
    // we know CMR has collections which are not in Cumulus
    expect(report.collectionsInCumulusCmr.onlyInCmr.length).toBeGreaterThan(0);
  });

  afterAll(() =>
    Promise.all([
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
    ]));
});

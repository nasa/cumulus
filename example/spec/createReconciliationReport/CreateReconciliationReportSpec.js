'use strict';

const cloneDeep = require('lodash.clonedeep');
const fs = require('fs-extra');
const {
  aws: {
    buildS3Uri,
    deleteS3Files,
    dynamodb,
    lambda,
    s3
  },
  BucketsConfig,
  bucketsConfigJsonObject,
  constructCollectionId,
  testUtils: {
    randomString,
    randomStringFromRegex
  }
} = require('@cumulus/common');

const { CMR } = require('@cumulus/cmrjs');
const { Granule } = require('@cumulus/api/models');
const {
  addCollections,
  addProviders,
  buildAndExecuteWorkflow,
  cleanupCollections,
  cleanupProviders,
  generateCmrXml,
  granulesApi: granulesApiTestUtils,
  waitForConceptExistsOutcome,
  waitUntilGranuleStatusIs
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
const collectionsDir = './data/collections/s3_MYD13Q1_006';
const inputPayloadFilename = './spec/createReconciliationReport/IngestGranule.MYD13Q1_006.input.payload.json';
const collection = { name: 'MYD13Q1', version: '006' };
const collectionId = constructCollectionId(collection.name, collection.version);
const granuleRegex = '^MYD13Q1\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

const config = loadConfig();

process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
process.env.GranulesTable = `${config.stackName}-GranulesTable`;
const granuleModel = new Granule();

const cmr = new CMR(config.cmr.provider, config.cmr.clientId, config.cmr.username, config.cmr.password);

async function findProtectedBucket(systemBucket, stackName) {
  const bucketsConfig = new BucketsConfig(await bucketsConfigJsonObject(systemBucket, stackName));
  const protectedBucketConfig = bucketsConfig.protectedBuckets();
  if (!protectedBucketConfig) throw new Error(`Unable to find protected bucket in ${JSON.stringify(bucketsConfig)}`);
  return protectedBucketConfig[0].name;
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

// add MYD13Q1___006 collection
async function setupCollectionAndTestData(testSuffix, testDataFolder) {
  const s3data = [
    '@cumulus/test-data/granules/MYD13Q1.A2002185.h00v09.006.2015149071135.hdf.met',
    '@cumulus/test-data/granules/MYD13Q1.A2002185.h00v09.006.2015149071135.hdf',
    '@cumulus/test-data/granules/BROWSE.MYD13Q1.A2002185.h00v09.006.2015149071135.hdf',
    '@cumulus/test-data/granules/BROWSE.MYD13Q1.A2002185.h00v09.006.2015149071135.1.jpg'
  ];

  // populate collections, providers and test data
  await Promise.all([
    uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
    addCollections(config.stackName, config.bucket, collectionsDir),
    addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix)
  ]);
}

// ingest a granule and publish if requested
async function ingestAndPublishGranule(testSuffix, testDataFolder, publish = true) {
  const workflowName = publish ? 'IngestAndPublishGranule' : 'IngestGranule';
  const provider = { id: `s3_provider${testSuffix}` };

  const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
  // update test data filepaths
  const inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, '', testDataFolder);

  await buildAndExecuteWorkflow(
    config.stackName, config.bucket, workflowName, collection, provider, inputPayload
  );

  await waitUntilGranuleStatusIs(config.stackName, inputPayload.granules[0].granuleId, 'completed');

  return inputPayload.granules[0].granuleId;
}

// ingest a granule xml to CMR
async function ingestGranuleToCMR() {
  const granuleId = randomStringFromRegex(granuleRegex);
  console.log(`\ningestGranuleToCMR granule id: ${granuleId}`);
  const xml = generateCmrXml({ granuleId }, collection);
  await cmr.ingestGranule(xml);
  return granuleId;
}

// update granule file which matches the regex
async function updateGranuleFile(granuleId, granuleFiles, regex, replacement) {
  console.log(`update granule file: ${granuleId} regex ${regex} to ${replacement}`);
  let originalGranuleFile;
  let updatedGranuleFile;
  const updatedFiles = granuleFiles.map((file) => {
    const updatedFile = cloneDeep(file);
    if (file.fileName.match(regex)) {
      originalGranuleFile = file;
      updatedGranuleFile = updatedFile;
    }
    updatedFile.fileName = updatedFile.fileName.replace(regex, replacement);
    updatedFile.key = updatedFile.key.replace(regex, replacement);
    return updatedFile;
  });
  await granuleModel.update({ granuleId: granuleId }, { files: updatedFiles });
  return { originalGranuleFile, updatedGranuleFile };
}

describe('When there are granule differences and granule reconciliation is run', () => {
  let report;
  let extraS3Object;
  let extraFileInDb;
  let extraCumulusCollection;
  let protectedBucket;
  let testDataFolder;
  let testSuffix;

  // granuleIds of the granules in both Cumulus and CMR, only in Cumulus, only in CMR
  let publishedGranule;
  let dbGranule;
  let cmrGranule;

  // the original file and updated file object of granule files being updated
  let originalGranuleFile;
  let updatedGranuleFile;

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

    await setupCollectionAndTestData(testSuffix, testDataFolder);

    const ingestResults = await Promise.all([
      // ingest a granule and publish it to CMR
      ingestAndPublishGranule(testSuffix, testDataFolder),

      // ingest a granule but not publish it to CMR
      ingestAndPublishGranule(testSuffix, testDataFolder, false),

      // ingest a granule to CMR only
      ingestGranuleToCMR()
    ]);

    [publishedGranule, dbGranule, cmrGranule] = ingestResults;

    // update one of the granule files in database so that that file won't match with CMR
    const granuleResponse = await granulesApiTestUtils.getGranule({
      prefix: config.stackName,
      granuleId: publishedGranule
    });

    ({ originalGranuleFile, updatedGranuleFile } = await updateGranuleFile(publishedGranule, JSON.parse(granuleResponse.body).files, /jpg$/, 'jpg2'));

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

    console.log(`update granule files back ${publishedGranule}`);
    await granuleModel.update({ granuleId: publishedGranule }, { files: JSON.parse(granuleResponse.body).files });
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
    // MYD13Q1___006 is in both Cumulus and CMR
    expect(report.collectionsInCumulusCmr.okCount).toBeGreaterThanOrEqual(1);
  });

  it('generates a report showing collections that are in the Cumulus but not in CMR', () => {
    const extraCollection = constructCollectionId(extraCumulusCollection.name.S, extraCumulusCollection.version.S);
    expect(report.collectionsInCumulusCmr.onlyInCumulus).toContain(extraCollection);
    expect(report.collectionsInCumulusCmr.onlyInCumulus).not.toContain(collectionId);
  });

  it('generates a report showing collections that are in the CMR but not in Cumulus', () => {
    // we know CMR has collections which are not in Cumulus
    expect(report.collectionsInCumulusCmr.onlyInCmr.length).toBeGreaterThanOrEqual(1);
    expect(report.collectionsInCumulusCmr.onlyInCmr).not.toContain(collectionId);
  });

  it('generates a report showing number of granules that are in both Cumulus and CMR', () => {
    // published granule should in both Cumulus and CMR
    expect(report.granulesInCumulusCmr.okCount).toBeGreaterThanOrEqual(1);
  });

  it('generates a report showing granules that are in the Cumulus but not in CMR', () => {
    // ingested (not published) granule should only in Cumulus
    const cumulusGranuleIds = report.granulesInCumulusCmr.onlyInCumulus.map((gran) => gran.granuleId);
    expect(cumulusGranuleIds).toContain(dbGranule);
    expect(cumulusGranuleIds).not.toContain(publishedGranule);
  });

  it('generates a report showing granules that are in the CMR but not in Cumulus', () => {
    const cmrGranuleIds = report.granulesInCumulusCmr.onlyInCmr.map((gran) => gran.GranuleUR);
    expect(cmrGranuleIds.length).toBeGreaterThanOrEqual(1);
    expect(cmrGranuleIds).toContain(cmrGranule);
    expect(cmrGranuleIds).not.toContain(dbGranule);
    expect(cmrGranuleIds).not.toContain(publishedGranule);
  });

  it('generates a report showing number of granule files that are in both Cumulus and CMR', () => {
    // published granule should have 2 files in both Cumulus and CMR
    expect(report.filesInCumulusCmr.okCount).toBeGreaterThanOrEqual(2);
  });

  it('generates a report showing granule files that are in the Cumulus but not in CMR', () => {
    // published granule should have one file(renamed file) in Cumulus
    const fileNames = report.filesInCumulusCmr.onlyInCumulus.map((file) => file.fileName);
    expect(fileNames).toContain(updatedGranuleFile.fileName);
    expect(fileNames).not.toContain(originalGranuleFile.fileName);
    expect(report.filesInCumulusCmr.onlyInCumulus.filter((file) => file.granuleId === publishedGranule).length)
      .toBe(1);
  });

  it('generates a report showing granule files that are in the CMR but not in Cumulus', () => {
    const urls = report.filesInCumulusCmr.onlyInCmr;
    expect(urls.find((url) => url.URL.endsWith(originalGranuleFile.fileName))).toBeTruthy();
    expect(urls.find((url) => url.URL.endsWith(updatedGranuleFile.fileName))).toBeFalsy();
    // TBD update to 1 after the s3credentials url has type 'VIEW RELATED INFORMATION' (CUMULUS-1182)
    // Cumulus 670 has a fix for the issue noted above from 1182.  Setting to 1.
    expect(report.filesInCumulusCmr.onlyInCmr.filter((file) => file.GranuleUR === publishedGranule).length)
      .toBe(1);
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
      // leave collections in the table for EMS reports
      //cleanupCollections(config.stackName, config.bucket, collectionsDir),
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix),
      granulesApiTestUtils.deleteGranule({ prefix: config.stackName, granuleId: dbGranule }),
      cmr.deleteGranule(cmrGranule)
    ]);

    const granuleResponse = await granulesApiTestUtils.getGranule({
      prefix: config.stackName,
      granuleId: publishedGranule
    });

    await granulesApiTestUtils.removeFromCMR({ prefix: config.stackName, granuleId: publishedGranule });
    await waitForConceptExistsOutcome(JSON.parse(granuleResponse.body).cmrLink, false);
    await granulesApiTestUtils.deleteGranule({ prefix: config.stackName, granuleId: publishedGranule });
  });
});

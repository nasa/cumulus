'use strict';

const cloneDeep = require('lodash/cloneDeep');
const moment = require('moment');
const fs = require('fs-extra');
const get = require('lodash/get');
const isEqual = require('lodash/isEqual');
const pWaitFor = require('p-wait-for');

const reconciliationReportsApi = require('@cumulus/api-client/reconciliationReports');
const {
  buildS3Uri, fileExists, getJsonS3Object, parseS3Uri, s3PutObject, deleteS3Object,
} = require('@cumulus/aws-client/S3');
const { CMR } = require('@cumulus/cmr-client');
const { lambda, s3 } = require('@cumulus/aws-client/services');
const BucketsConfig = require('@cumulus/common/BucketsConfig');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { getBucketsConfigKey } = require('@cumulus/common/stack');
const { randomString, randomId, randomStringFromRegex } = require('@cumulus/common/test-utils');
const { getExecutionWithStatus } = require('@cumulus/integration-tests/Executions');

const GranuleFilesCache = require('@cumulus/api/lib/GranuleFilesCache');
const { Granule } = require('@cumulus/api/models');
const {
  addCollections,
  addProviders,
  buildAndExecuteWorkflow,
  cleanupCollections,
  cleanupProviders,
  generateCmrXml,
  granulesApi: granulesApiTestUtils,
  waitForAsyncOperationStatus,
} = require('@cumulus/integration-tests');

const { getGranuleWithStatus } = require('@cumulus/integration-tests/Granules');
const { createCollection } = require('@cumulus/integration-tests/Collections');
const { createProvider } = require('@cumulus/integration-tests/Providers');
const { deleteCollection, getCollections } = require('@cumulus/api-client/collections');
const { deleteGranule } = require('@cumulus/api-client/granules');
const { deleteProvider } = require('@cumulus/api-client/providers');
const { getCmrSettings } = require('@cumulus/cmrjs/cmr-utils');

const {
  loadConfig,
  uploadTestDataToBucket,
  deleteFolder,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
} = require('../../helpers/testUtils');
const {
  setupTestGranuleForIngest, waitForGranuleRecordUpdatedInList,
} = require('../../helpers/granuleUtils');
const { waitForModelStatus } = require('../../helpers/apiUtils');

const providersDir = './data/providers/s3/';
const collectionsDir = './data/collections/s3_MYD13Q1_006';
const collection = { name: 'MYD13Q1', version: '006' };
const onlyCMRCollection = { name: 'L2_HR_PIXC', version: '1' };

const granuleRegex = '^MYD13Q1\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

async function findProtectedBucket(systemBucket, stackName) {
  const bucketsConfig = new BucketsConfig(
    await getJsonS3Object(systemBucket, getBucketsConfigKey(stackName))
  );
  const protectedBucketConfig = bucketsConfig.protectedBuckets();
  if (!protectedBucketConfig) throw new Error(`Unable to find protected bucket in ${JSON.stringify(bucketsConfig)}`);
  return protectedBucketConfig[0].name;
}

// add MYD13Q1___006 collection
async function setupCollectionAndTestData(config, testSuffix, testDataFolder) {
  const s3data = [
    '@cumulus/test-data/granules/MYD13Q1.A2002185.h00v09.006.2015149071135.hdf.met',
    '@cumulus/test-data/granules/MYD13Q1.A2002185.h00v09.006.2015149071135.hdf',
    '@cumulus/test-data/granules/BROWSE.MYD13Q1.A2002185.h00v09.006.2015149071135.hdf',
    '@cumulus/test-data/granules/BROWSE.MYD13Q1.A2002185.h00v09.006.2015149071135.1.jpg',
  ];

  // populate collections, providers and test data
  await Promise.all([
    uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
    addCollections(config.stackName, config.bucket, collectionsDir),
    addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix),
  ]);
}

/**
 * Creates a new test collection with associated granule for testing.
 *
 * @param {string} prefix - stack Prefix
 * @param {string} sourceBucket - testing source bucket
 * @returns {Promise<Array>} A new collection with associated granule and a cleanup function to call after you are finished.
 */
const createActiveCollection = async (prefix, sourceBucket) => {
  // The S3 path where granules will be ingested from
  const sourcePath = `${prefix}/tmp/${randomId('test-')}`;

  // Create the collection
  const newCollection = await createCollection(
    prefix,
    {
      duplicateHandling: 'error',
      process: 'modis',
    }
  );

  // Create the S3 provider
  const provider = await createProvider(prefix, { host: sourceBucket });

  // Stage the granule files to S3
  const granFilename = `${randomId('junk-file-')}.txt`;
  const granFileKey = `${sourcePath}/${granFilename}`;
  await s3PutObject({
    Bucket: sourceBucket,
    Key: granFileKey,
    Body: 'aoeu',
  });

  const granuleId = randomId('granule-id-');

  const inputPayload = {
    granules: [
      {
        granuleId,
        dataType: newCollection.name,
        version: newCollection.version,
        files: [
          {
            name: granFilename,
            path: sourcePath,
          },
        ],
      },
    ],
  };

  const { executionArn: ingestGranuleExecutionArn } = await buildAndExecuteWorkflow(
    prefix, sourceBucket, 'IngestGranule', newCollection, provider, inputPayload
  );

  await waitForModelStatus(
    new Granule(),
    { granuleId: inputPayload.granules[0].granuleId },
    'completed'
  );

  // Wait for the execution to be completed
  await getExecutionWithStatus({
    prefix,
    arn: ingestGranuleExecutionArn,
    status: 'completed',
  });

  await getGranuleWithStatus({ prefix, granuleId, status: 'completed' });

  const cleanupFunction = async () => {
    await Promise.allSettled(
      [
        deleteS3Object(sourceBucket, granFileKey),
        deleteGranule({ prefix, granuleId }),
        deleteProvider({ prefix, providerId: get(provider, 'id') }),
        deleteCollection({
          prefix,
          collectionName: get(newCollection, 'name'),
          collectionVersion: get(newCollection, 'version'),
        }),
      ]
    );
  };

  return [newCollection, cleanupFunction];
};

// ingest a granule and publish if requested
async function ingestAndPublishGranule(config, testSuffix, testDataFolder, publish = true) {
  const workflowName = publish ? 'IngestAndPublishGranule' : 'IngestGranule';
  const provider = { id: `s3_provider${testSuffix}` };

  const inputPayloadJson = fs.readFileSync(
    './spec/parallel/createReconciliationReport/IngestGranule.MYD13Q1_006.input.payload.json',
    'utf8'
  );
  // update test data filepaths
  const inputPayload = await setupTestGranuleForIngest(
    config.bucket,
    inputPayloadJson,
    granuleRegex,
    '',
    testDataFolder
  );

  await buildAndExecuteWorkflow(
    config.stackName, config.bucket, workflowName, collection, provider, inputPayload
  );

  await waitForModelStatus(
    new Granule(),
    { granuleId: inputPayload.granules[0].granuleId },
    'completed'
  );

  if (!inputPayload.granules[0].granuleId) {
    throw new Error(`No granule id found in ${JSON.stringify(inputPayload)}`);
  }

  return inputPayload.granules[0].granuleId;
}

const createCmrClient = async (config) => {
  const lambdaFunction = `${config.stackName}-CreateReconciliationReport`;
  const lambdaConfig = await lambda().getFunctionConfiguration({ FunctionName: lambdaFunction })
    .promise();
  Object.entries(lambdaConfig.Environment.Variables).forEach(([key, value]) => {
    process.env[key] = value;
  });
  const cmrSettings = await getCmrSettings();
  return new CMR(cmrSettings);
};

// ingest a granule xml to CMR
async function ingestGranuleToCMR(cmrClient) {
  const granuleId = randomStringFromRegex(granuleRegex);
  console.log(`\ningestGranuleToCMR granule id: ${granuleId}`);
  const xml = generateCmrXml({ granuleId }, collection);
  await cmrClient.ingestGranule(xml);
  return { granuleId };
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
  await (new Granule()).update({ granuleId: granuleId }, { files: updatedFiles });
  return { originalGranuleFile, updatedGranuleFile };
}

// wait for collection in list
const waitForCollectionRecordsInList = async (stackName, collectionIds, additionalQueryParams = {}) => pWaitFor(
  async () => {
    // Verify the collection is returned when listing collections
    const collsResp = await getCollections({ prefix: stackName,
      query: { _id__in: collectionIds.join(','), ...additionalQueryParams, limit: 30 } });
    const results = get(JSON.parse(collsResp.body), 'results', []);
    const ids = results.map((c) => constructCollectionId(c.name, c.version));
    return isEqual(ids.sort(), collectionIds.sort());
  },
  {
    interval: 10000,
    timeout: 600 * 1000,
  }
);

describe('When there are granule differences and granule reconciliation is run', () => {
  let asyncOperationId;
  let beforeAllFailed = false;
  let cmrClient;
  let cmrGranule;
  let collectionId;
  let config;
  let dbGranuleId;
  let extraCumulusCollection;
  let extraCumulusCollectionCleanup;
  let extraFileInDb;
  let extraS3Object;
  let granuleBeforeUpdate;
  let granuleModel;
  let originalGranuleFile;
  let protectedBucket;
  let publishedGranuleId;
  let testDataFolder;
  let testSuffix;
  let updatedGranuleFile;
  const ingestTime = Date.now() - 1000 * 30;

  beforeAll(async () => {
    try {
      collectionId = constructCollectionId(collection.name, collection.version);

      config = await loadConfig();
      process.env.ProvidersTable = `${config.stackName}-ProvidersTable`;
      process.env.GranulesTable = `${config.stackName}-GranulesTable`;
      granuleModel = new Granule();

      process.env.ReconciliationReportsTable = `${config.stackName}-ReconciliationReportsTable`;
      process.env.CMR_ENVIRONMENT = 'UAT';

      cmrClient = await createCmrClient(config);

      // Find a protected bucket
      protectedBucket = await findProtectedBucket(config.bucket, config.stackName);

      // Write an extra S3 object to the protected bucket
      extraS3Object = { Bucket: protectedBucket, Key: randomString() };
      await s3().putObject({ Body: 'delete-me', ...extraS3Object }).promise();

      // Write an extra file to the DynamoDB Files table
      extraFileInDb = {
        bucket: protectedBucket,
        key: randomString(),
        granuleId: randomString(),
      };
      process.env.FilesTable = `${config.stackName}-FilesTable`;
      await GranuleFilesCache.put(extraFileInDb);

      const activeCollectionPromise = createActiveCollection(config.stackName, config.bucket);

      const testId = createTimestampedTestId(config.stackName, 'CreateReconciliationReport');
      testSuffix = createTestSuffix(testId);
      testDataFolder = createTestDataPath(testId);

      console.log('XXX Waiting for setupCollectionAndTestData');
      await setupCollectionAndTestData(config, testSuffix, testDataFolder);
      console.log('XXX Completed for setupCollectionAndTestData');

      [
        publishedGranuleId,
        dbGranuleId,
        cmrGranule,
        [extraCumulusCollection, extraCumulusCollectionCleanup],
      ] = await Promise.all([
        ingestAndPublishGranule(config, testSuffix, testDataFolder),
        ingestAndPublishGranule(config, testSuffix, testDataFolder, false),
        ingestGranuleToCMR(cmrClient),
        activeCollectionPromise,
      ]);

      console.log('XXXXX Waiting for collections in list');
      const collectionIds = [
        collectionId,
        constructCollectionId(extraCumulusCollection.name, extraCumulusCollection.version),
      ];

      await waitForCollectionRecordsInList(config.stackName, collectionIds, { timestamp__from: ingestTime });

      // update one of the granule files in database so that that file won't match with CMR
      console.log('XXXXX Waiting for granulesApiTestUtils.getGranule()');
      granuleBeforeUpdate = await granulesApiTestUtils.getGranule({
        prefix: config.stackName,
        granuleId: publishedGranuleId,
      });
      console.log('XXXXX Completed for granulesApiTestUtils.getGranule()');
      await waitForGranuleRecordUpdatedInList(config.stackName, JSON.parse(granuleBeforeUpdate.body));
      console.log('XXXXX Waiting for updateGranuleFile(publishedGranuleId, JSON.parse(granuleBeforeUpdate.body).files, /jpg$/, \'jpg2\'))');
      ({ originalGranuleFile, updatedGranuleFile } = await updateGranuleFile(publishedGranuleId, JSON.parse(granuleBeforeUpdate.body).files, /jpg$/, 'jpg2'));
      console.log('XXXXX Completed for updateGranuleFile(publishedGranuleId, JSON.parse(granuleBeforeUpdate.body).files, /jpg$/, \'jpg2\'))');

      const [dbGranule, granuleAfterUpdate] = await Promise.all([
        granulesApiTestUtils.getGranule({ prefix: config.stackName, granuleId: dbGranuleId }),
        granulesApiTestUtils.getGranule({ prefix: config.stackName, granuleId: publishedGranuleId }),
      ]);
      console.log('XXXX Waiting for granules updated in list');
      await Promise.all([
        waitForGranuleRecordUpdatedInList(config.stackName, JSON.parse(dbGranule.body)),
        waitForGranuleRecordUpdatedInList(config.stackName, JSON.parse(granuleAfterUpdate.body)),
      ]);
    } catch (error) {
      console.log(error);
      beforeAllFailed = true;
      throw error;
    }
  });

  it('prepares the test suite successfully', async () => {
    if (beforeAllFailed) fail('beforeAll() failed to prepare test suite');
  });

  describe('Create an Inventory Reconciliation Report to monitor inventory discrepancies', () => {
    // report record in db and report in s3
    let reportRecord;
    let report;
    it('generates an async operation through the Cumulus API', async () => {
      const response = await reconciliationReportsApi.createReconciliationReport({
        prefix: config.stackName,
        request: { collectionId: [
          constructCollectionId(collection.name, collection.version),
          constructCollectionId(extraCumulusCollection.name, extraCumulusCollection.version),
          constructCollectionId(onlyCMRCollection.name, onlyCMRCollection.version),
        ] },
      });

      const responseBody = JSON.parse(response.body);
      asyncOperationId = responseBody.id;
      expect(responseBody.operationType).toBe('Reconciliation Report');
    });

    it('generates reconciliation report through the Cumulus API', async () => {
      const asyncOperation = await waitForAsyncOperationStatus({
        id: asyncOperationId,
        status: 'SUCCEEDED',
        stackName: config.stackName,
        retries: 100,
      });

      reportRecord = JSON.parse(asyncOperation.output);
    });

    it('fetches a reconciliation report through the Cumulus API', async () => {
      const response = await reconciliationReportsApi.getReconciliationReport({
        prefix: config.stackName,
        name: reportRecord.name,
      });

      report = JSON.parse(response.body);
      expect(report.reportType).toBe('Inventory');
      expect(report.status).toBe('SUCCESS');
    });

    it('generates a report showing cumulus files that are in S3 but not in the DynamoDB Files table', () => {
      const extraS3ObjectUri = buildS3Uri(extraS3Object.Bucket, extraS3Object.Key);
      expect(report.filesInCumulus.onlyInS3).toContain(extraS3ObjectUri);
    });

    it('generates a report showing cumulus files that are in the DynamoDB Files table but not in S3', () => {
      const extraFileUri = buildS3Uri(extraFileInDb.bucket, extraFileInDb.key);
      const extraDbUris = report.filesInCumulus.onlyInDynamoDb.map((i) => i.uri);
      expect(extraDbUris).toContain(extraFileUri);
    });

    it('generates a report showing number of collections that are in both Cumulus and CMR', () => {
      // MYD13Q1___006 is in both Cumulus and CMR
      expect(report.collectionsInCumulusCmr.okCount).toBeGreaterThanOrEqual(1);
    });

    it('generates a report showing collections that are in Cumulus but not in CMR', () => {
      const extraCollection = constructCollectionId(extraCumulusCollection.name, extraCumulusCollection.version);
      expect(report.collectionsInCumulusCmr.onlyInCumulus).toContain(extraCollection);
      expect(report.collectionsInCumulusCmr.onlyInCumulus).not.toContain(collectionId);
    });

    it('generates a report showing the amount of files that match broken down by Granule', () => {
      const okCount = report.filesInCumulus.okCount;
      const totalOkCountByGranule = Object.values(report.filesInCumulus.okCountByGranule).reduce(
        (total, currentOkCount) => total + currentOkCount
      );
      expect(totalOkCountByGranule).toEqual(okCount);
    });

    it('generates a report showing collections that are in the CMR but not in Cumulus', () => {
      // we know CMR has collections which are not in Cumulus
      expect(report.collectionsInCumulusCmr.onlyInCmr.length).toBe(1);
      expect(report.collectionsInCumulusCmr.onlyInCmr).not.toContain(collectionId);
    });

    it('generates a report showing number of granules that are in both Cumulus and CMR', () => {
      // published granule should in both Cumulus and CMR
      expect(report.granulesInCumulusCmr.okCount).toBeGreaterThanOrEqual(1);
    });

    it('generates a report showing granules that are in the Cumulus but not in CMR', () => {
      // ingested (not published) granule should only in Cumulus
      const cumulusGranuleIds = report.granulesInCumulusCmr.onlyInCumulus.map((gran) => gran.granuleId);
      expect(cumulusGranuleIds).toContain(dbGranuleId);
      expect(cumulusGranuleIds).not.toContain(publishedGranuleId);
    });

    it('generates a report showing granules that are in the CMR but not in Cumulus', () => {
      const cmrGranuleIds = report.granulesInCumulusCmr.onlyInCmr.map((gran) => gran.GranuleUR);
      expect(cmrGranuleIds.length).toBeGreaterThanOrEqual(1);
      expect(cmrGranuleIds).toContain(cmrGranule.granuleId);
      expect(cmrGranuleIds).not.toContain(dbGranuleId);
      expect(cmrGranuleIds).not.toContain(publishedGranuleId);
    });

    it('generates a report showing number of granule files that are in both Cumulus and CMR', () => {
      // published granule should have 2 files in both Cumulus and CMR
      expect(report.filesInCumulusCmr.okCount).toBeGreaterThanOrEqual(2);
    });

    it('generates a report showing granule files that are in Cumulus but not in CMR', () => {
      // published granule should have one file(renamed file) in Cumulus
      const fileNames = report.filesInCumulusCmr.onlyInCumulus.map((file) => file.fileName);
      expect(fileNames).toContain(updatedGranuleFile.fileName);
      expect(fileNames).not.toContain(originalGranuleFile.fileName);
      expect(report.filesInCumulusCmr.onlyInCumulus.filter((file) => file.granuleId === publishedGranuleId).length)
        .toBe(1);
    });

    it('generates a report showing granule files that are in the CMR but not in Cumulus', () => {
      const urls = report.filesInCumulusCmr.onlyInCmr;
      expect(urls.find((url) => url.URL.endsWith(originalGranuleFile.fileName))).toBeTruthy();
      expect(urls.find((url) => url.URL.endsWith(updatedGranuleFile.fileName))).toBeFalsy();
      // TBD update to 1 after the s3credentials url has type 'VIEW RELATED INFORMATION' (CUMULUS-1182)
      // Cumulus 670 has a fix for the issue noted above from 1182.  Setting to 1.
      expect(report.filesInCumulusCmr.onlyInCmr.filter((file) => file.GranuleUR === publishedGranuleId).length)
        .toBe(2);
    });

    it('deletes a reconciliation report through the Cumulus API', async () => {
      await reconciliationReportsApi.deleteReconciliationReport({
        prefix: config.stackName,
        name: reportRecord.name,
      });

      const parsed = parseS3Uri(reportRecord.location);
      const exists = await fileExists(parsed.Bucket, parsed.Key);
      expect(exists).toBeFalse();

      const response = await reconciliationReportsApi.getReconciliationReport({
        prefix: config.stackName,
        name: reportRecord.name,
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).message).toBe(`No record found for ${reportRecord.name}`);
    });
  });

  describe('Create an Internal Reconciliation Report to monitor internal discrepancies', () => {
    // report record in db and report in s3
    let reportRecord;
    let report;
    it('generates an async operation through the Cumulus API', async () => {
      const request = {
        reportType: 'Internal',
        reportName: randomId('InternalReport'),
        endTimestamp: moment.utc().format(),
        collectionId,
        granuleId: [publishedGranuleId, dbGranuleId, randomId('granuleId')],
        provider: [randomId('provider'), `s3_provider${testSuffix}`],
      };
      const response = await reconciliationReportsApi.createReconciliationReport({
        prefix: config.stackName,
        request,
      });

      const responseBody = JSON.parse(response.body);
      asyncOperationId = responseBody.id;
      expect(responseBody.operationType).toBe('Reconciliation Report');
    });

    it('generates reconciliation report through the Cumulus API', async () => {
      const asyncOperation = await waitForAsyncOperationStatus({
        id: asyncOperationId,
        status: 'SUCCEEDED',
        stackName: config.stackName,
        retries: 100,
      });

      reportRecord = JSON.parse(asyncOperation.output);
    });

    it('fetches a reconciliation report through the Cumulus API', async () => {
      const response = await reconciliationReportsApi.getReconciliationReport({
        prefix: config.stackName,
        name: reportRecord.name,
      });

      report = JSON.parse(response.body);
      expect(report.reportType).toBe('Internal');
      expect(report.status).toBe('SUCCESS');
    });

    it('generates a report showing number of collections that are in both ES and DB', () => {
      expect(report.collections.okCount).toBe(1);
      expect(report.collections.withConflicts.length).toBe(0);
      expect(report.collections.onlyInEs.length).toBe(0);
      expect(report.collections.onlyInDb.length).toBe(0);
    });

    it('generates a report showing number of granules that are in both ES and DB', () => {
      expect(report.granules.okCount).toBe(2);
      expect(report.granules.withConflicts.length).toBe(0);
      if (report.granules.withConflicts.length !== 0) {
        console.log(`XXXX ${JSON.stringify(report.granules.withConflicts)}`);
      }
      expect(report.granules.onlyInEs.length).toBe(0);
      expect(report.granules.onlyInDb.length).toBe(0);
    });

    it('deletes a reconciliation report through the Cumulus API', async () => {
      await reconciliationReportsApi.deleteReconciliationReport({
        prefix: config.stackName,
        name: reportRecord.name,
      });

      const parsed = parseS3Uri(reportRecord.location);
      const exists = await fileExists(parsed.Bucket, parsed.Key);
      expect(exists).toBeFalse();

      const response = await reconciliationReportsApi.getReconciliationReport({
        prefix: config.stackName,
        name: reportRecord.name,
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).message).toBe(`No record found for ${reportRecord.name}`);
    });
  });

  describe('Creates \'Granule Inventory\' reports.', () => {
    let reportRecord;
    let reportArray;
    let redirectResponse;
    it('generates an async operation through the Cumulus API', async () => {
      const request = {
        reportType: 'Granule Inventory',
        reportName: randomId('granuleInventory'),
        endTimestamp: moment.utc().format(),
        collectionId,
        granuleIds: [publishedGranuleId, dbGranuleId],
      };
      const response = await reconciliationReportsApi.createReconciliationReport({
        prefix: config.stackName,
        request,
      });

      const responseBody = JSON.parse(response.body);
      asyncOperationId = responseBody.id;
      expect(responseBody.operationType).toBe('Reconciliation Report');
    });

    it('generates reconciliation report through the Cumulus API', async () => {
      const asyncOperation = await waitForAsyncOperationStatus({
        id: asyncOperationId,
        status: 'SUCCEEDED',
        stackName: config.stackName,
        retries: 100,
      });

      reportRecord = JSON.parse(asyncOperation.output);
    });

    it('Fetches an object with a signedURL to the Granule Inventory report through the Cumulus API', async () => {
      redirectResponse = await reconciliationReportsApi.getReconciliationReport({
        prefix: config.stackName,
        name: reportRecord.name,
      });

      expect(redirectResponse.statusCode).toBe(200);
      const redirectUrl = JSON.parse(redirectResponse.body).url;
      expect(redirectUrl).toMatch(`reconciliation-reports/${reportRecord.name}.csv?`);
      expect(redirectUrl).toMatch('AWSAccessKeyId');
      expect(redirectUrl).toMatch('Signature');
    });

    it('Wrote correct data to the S3 location.', async () => {
      const pieces = new RegExp('https://(.*)\.s3.amazonaws.com/(.*)\\?.*', 'm');
      const [, Bucket, Key] = JSON.parse(redirectResponse.body).url.match(pieces);
      let response;
      try {
        response = await s3().getObject({ Bucket, Key }).promise();
      } catch (error) {
        console.error(error);
      }

      reportArray = response.Body.toString().split('\n');

      [
        'granuleUr',
        'collectionId',
        'createdAt',
        'startDateTime',
        'endDateTime',
        'status',
        'updatedAt',
        'published',
      ].forEach((field) => expect(reportArray[0]).toMatch(field));
    });

    it('includes correct records', () => {
      [
        collectionId,
        dbGranuleId,
        publishedGranuleId,
      ].forEach((testStr) => {
        // found in report
        expect(reportArray.some((record) => record.includes(testStr))).toBe(true);
      });

      const omittedCollectionId = constructCollectionId(extraCumulusCollection.name, extraCumulusCollection.version);
      expect(reportArray.some((record) => record.includes(omittedCollectionId))).toBe(false);
    });

    it('deletes a reconciliation report through the Cumulus API', async () => {
      await reconciliationReportsApi.deleteReconciliationReport({
        prefix: config.stackName,
        name: reportRecord.name,
      });

      const parsed = parseS3Uri(reportRecord.location);
      const exists = await fileExists(parsed.Bucket, parsed.Key);
      expect(exists).toBeFalse();

      const response = await reconciliationReportsApi.getReconciliationReport({
        prefix: config.stackName,
        name: reportRecord.name,
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).message).toBe(`No record found for ${reportRecord.name}`);
    });
  });

  afterAll(async () => {
    console.log(`update granule files back ${publishedGranuleId}`);
    await granuleModel.update({ granuleId: publishedGranuleId }, { files: JSON.parse(granuleBeforeUpdate.body).files });

    await Promise.all([
      s3().deleteObject(extraS3Object).promise(),
      GranuleFilesCache.del(extraFileInDb),
      deleteFolder(config.bucket, testDataFolder),
      cleanupCollections(config.stackName, config.bucket, collectionsDir),
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix),
      granulesApiTestUtils.deleteGranule({ prefix: config.stackName, granuleId: dbGranuleId }),
      extraCumulusCollectionCleanup(),
      cmrClient.deleteGranule(cmrGranule),
    ]);

    await granulesApiTestUtils.removeFromCMR({ prefix: config.stackName, granuleId: publishedGranuleId });
    await granulesApiTestUtils.deleteGranule({ prefix: config.stackName, granuleId: publishedGranuleId });
  });
});

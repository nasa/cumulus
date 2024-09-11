'use strict';

const cloneDeep = require('lodash/cloneDeep');
const moment = require('moment');
const fs = require('fs-extra');
const get = require('lodash/get');
const got = require('got');
const isEqual = require('lodash/isEqual');
const isNil = require('lodash/isNil');
const pWaitFor = require('p-wait-for');
const { GetFunctionConfigurationCommand } = require('@aws-sdk/client-lambda');

const { deleteAsyncOperation } = require('@cumulus/api-client/asyncOperations');
const reconciliationReportsApi = require('@cumulus/api-client/reconciliationReports');
const {
  buildS3Uri, fileExists, getJsonS3Object, parseS3Uri, s3PutObject,
} = require('@cumulus/aws-client/S3');
const { CMR } = require('@cumulus/cmr-client');
const { lambda, s3 } = require('@cumulus/aws-client/services');
const BucketsConfig = require('@cumulus/common/BucketsConfig');
const { getBucketsConfigKey } = require('@cumulus/common/stack');
const { randomString, randomId, randomStringFromRegex } = require('@cumulus/common/test-utils');
const { getExecutionWithStatus } = require('@cumulus/integration-tests/Executions');

const {
  addCollections,
  addProviders,
  cleanupProviders,
  generateCmrXml,
  waitForAsyncOperationStatus,
} = require('@cumulus/integration-tests');

const { getGranuleWithStatus } = require('@cumulus/integration-tests/Granules');
const { createCollection } = require('@cumulus/integration-tests/Collections');
const { createProvider } = require('@cumulus/integration-tests/Providers');
const { getCollections } = require('@cumulus/api-client/collections');
const {
  createGranule,
  getGranule,
  updateGranule,
} = require('@cumulus/api-client/granules');
const { getCmrSettings } = require('@cumulus/cmrjs/cmr-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');

const {
  waitForApiStatus,
} = require('../../helpers/apiUtils');
const {
  loadConfig,
  uploadTestDataToBucket,
  deleteFolder,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
} = require('../../helpers/testUtils');
const { removeCollectionAndAllDependencies } = require('../../helpers/Collections');
const {
  setupTestGranuleForIngest, waitForGranuleRecordUpdatedInList,
} = require('../../helpers/granuleUtils');
const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');

const providersDir = './data/providers/s3/';
const collectionsDir = './data/collections/s3_MYD13Q1_006';
const collection = { name: 'MYD13Q1', version: '006' };
const onlyCMRCollection = { name: 'L2_HR_PIXC', version: '1' };

const granuleRegex = '^MYD13Q1\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

const ingestWithOrcaWorkflowName = 'IngestAndPublishGranuleWithOrca';

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
  await removeCollectionAndAllDependencies({ prefix: config.stackName, collection });
  // populate collections, providers and test data
  console.log('\nXXX Completed removing collection and all dependencies');
  await Promise.all([
    uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
    addCollections(config.stackName, config.bucket, collectionsDir),
    addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix),
  ]);
}

let ingestGranuleExecutionArn;
const ingestAndPublishGranuleExecutionArns = [];

// TODO: [CUMULUS-2567] These should be in a helper, possibly unit tested.
/**
 * Creates a new test collection with associated granule for testing.
 *
 * @param {string} prefix - stack Prefix
 * @param {string} sourceBucket - testing source bucket
 * @returns {Promise<Object>}  The collection created
 */
const createActiveCollection = async (prefix, sourceBucket) => {
  // The S3 path where granules will be ingested from
  const sourcePath = `${prefix}/tmp/${randomId('test-')}`;

  // Create the collection
  const newCollection = await createCollection(prefix, {
    duplicateHandling: 'error',
    process: 'modis',
  });

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

  const workflowExecution = await buildAndExecuteWorkflow(
    prefix,
    sourceBucket,
    'IngestGranule',
    newCollection,
    provider,
    inputPayload
  );

  ingestGranuleExecutionArn = workflowExecution.executionArn;

  await waitForApiStatus(
    getGranule,
    {
      prefix,
      granuleId: inputPayload.granules[0].granuleId,
      collectionId: constructCollectionId(
        newCollection.name,
        newCollection.version
      ),
    },
    'completed'
  );

  // Wait for the execution to be completed
  await getExecutionWithStatus({
    prefix,
    arn: ingestGranuleExecutionArn,
    status: 'completed',
  });

  await getGranuleWithStatus({
    prefix,
    granuleId,
    collectionId: constructCollectionId(
      newCollection.name,
      newCollection.version
    ),
    status: 'completed',
  });
  return newCollection;
};

// ingest a granule and publish if requested
async function ingestAndPublishGranule(config, testSuffix, testDataFolder, publish = true, isOrcaIncluded = true) {
  const ingestAndPublishWorkflow = isOrcaIncluded ? ingestWithOrcaWorkflowName : 'IngestAndPublishGranule';
  const workflowName = publish ? ingestAndPublishWorkflow : 'IngestGranule';
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

  const { executionArn } = await buildAndExecuteWorkflow(
    config.stackName, config.bucket, workflowName, collection, provider, inputPayload
  );

  ingestAndPublishGranuleExecutionArns.push(executionArn);

  await waitForApiStatus(
    getGranule,
    {
      prefix: config.stackName,
      granuleId: inputPayload.granules[0].granuleId,
      collectionId: constructCollectionId(collection.name, collection.version),
    },
    'completed'
  );

  if (!inputPayload.granules[0].granuleId) {
    throw new Error(`No granule id found in ${JSON.stringify(inputPayload)}`);
  }

  return inputPayload.granules[0].granuleId;
}

const createCmrClient = async (config) => {
  const lambdaFunction = `${config.stackName}-CreateReconciliationReport`;
  const lambdaConfig = await lambda().send(new GetFunctionConfigurationCommand({ FunctionName: lambdaFunction }));
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
async function updateGranuleFile(prefix, granule, regex, replacement) {
  const { granuleId, files } = granule;
  console.log(`update granule file: ${granuleId} regex ${regex} to ${replacement}`);
  let originalGranuleFile;
  let updatedGranuleFile;
  const updatedFiles = files.map((file) => {
    const updatedFile = cloneDeep(file);
    if (file.fileName.match(regex)) {
      originalGranuleFile = file;
      updatedGranuleFile = updatedFile;
    }
    updatedFile.fileName = updatedFile.fileName.replace(regex, replacement);
    updatedFile.key = updatedFile.key.replace(regex, replacement);
    return updatedFile;
  });
  await updateGranule({
    prefix,
    granuleId: granule.granuleId,
    collectionId: granule.collectionId,
    body: {
      ...granule,
      files: updatedFiles,
    },
  });
  return { originalGranuleFile, updatedGranuleFile };
}

// wait for collection in list
const waitForCollectionRecordsInList = async (stackName, collectionIds, additionalQueryParams = {}) => await pWaitFor(
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

// returns report content text
const fetchReconciliationReport = async (stackName, reportName) => {
  const response = await reconciliationReportsApi.getReconciliationReport({
    prefix: stackName,
    name: reportName,
  });

  if (response.statusCode !== 200) {
    throw new Error(`ReconciliationReport getReconciliationReport API did not return 200: ${JSON.stringify(response)}`);
  }

  const url = JSON.parse(response.body).presignedS3Url;
  if (isNil(url) || !url.includes(`reconciliation-reports/${reportName}`) ||
    !url.includes('Signature')) {
    throw new Error(`ReconciliationReport getReconciliationReport did not return valid url ${url}`);
  }

  const reportResponse = await got(url);
  return reportResponse.body;
};

describe('When there are granule differences and granule reconciliation is run', () => {
  let beforeAllFailed = false;
  let cmrClient;
  let cmrGranule;
  let collectionId;
  let config;
  let dbGranuleId;
  let extraCumulusCollection;
  let extraFileInDb;
  let extraGranuleInDb;
  let extraS3Object;
  let granuleBeforeUpdate;
  let originalGranuleFile;
  let protectedBucket;
  let publishedGranuleId;
  let testDataFolder;
  let testSuffix;
  let updatedGranuleFile;
  const ingestTime = Date.now() - 1000 * 30;
  const startTimestamp = moment.utc().format();

  beforeAll(async () => {
    try {
      collectionId = constructCollectionId(collection.name, collection.version);

      config = await loadConfig();

      process.env.ReconciliationReportsTable = `${config.stackName}-ReconciliationReportsTable`;
      process.env.CMR_ENVIRONMENT = 'UAT';

      cmrClient = await createCmrClient(config);

      // Find a protected bucket
      protectedBucket = await findProtectedBucket(config.bucket, config.stackName);

      // Write an extra S3 object to the protected bucket
      extraS3Object = { Bucket: protectedBucket, Key: randomString() };
      await s3().putObject({ Body: 'delete-me', ...extraS3Object });

      extraCumulusCollection = await createActiveCollection(config.stackName, config.bucket);
      const testId = createTimestampedTestId(config.stackName, 'CreateReconciliationReport');
      testSuffix = createTestSuffix(testId);
      testDataFolder = createTestDataPath(testId);

      console.log('XXX Waiting for setupCollectionAndTestData');
      await setupCollectionAndTestData(config, testSuffix, testDataFolder);
      console.log('XXX Completed for setupCollectionAndTestData');

      // Write an extra file to the DynamoDB Files table
      extraFileInDb = {
        bucket: protectedBucket,
        key: randomString(),
      };
      extraGranuleInDb = {
        granuleId: randomId('extra-granule'),
        collectionId,
        status: 'completed',
        files: [extraFileInDb],
      };
      await createGranule({
        prefix: config.stackName,
        body: extraGranuleInDb,
      });

      [
        publishedGranuleId,
        dbGranuleId,
        cmrGranule,
      ] = await Promise.all([
        ingestAndPublishGranule(config, testSuffix, testDataFolder, true),
        ingestAndPublishGranule(config, testSuffix, testDataFolder, false),
        ingestGranuleToCMR(cmrClient),
      ]);

      console.log('dbGranuleId', dbGranuleId);
      console.log('publishedGranuleId', publishedGranuleId);

      console.log('XXXXX Waiting for collections in list');
      const collectionIds = [
        collectionId,
        constructCollectionId(extraCumulusCollection.name, extraCumulusCollection.version),
      ];

      await waitForCollectionRecordsInList(config.stackName, collectionIds, { timestamp__from: ingestTime });

      // update one of the granule files in database so that that file won't match with CMR
      console.log('XXXXX Waiting for getGranule()');
      granuleBeforeUpdate = await getGranule({
        prefix: config.stackName,
        granuleId: publishedGranuleId,
        collectionId,
      });
      console.log('XXXXX Completed for getGranule()');
      await waitForGranuleRecordUpdatedInList(config.stackName, granuleBeforeUpdate);
      console.log(`XXXXX Waiting for updateGranuleFile(${publishedGranuleId})`);
      ({ originalGranuleFile, updatedGranuleFile } = await updateGranuleFile(
        config.stackName,
        granuleBeforeUpdate,
        /jpg$/,
        'jpg2'
      ));
      console.log(`XXXXX Completed for updateGranuleFile(${publishedGranuleId})`);

      const [dbGranule, granuleAfterUpdate] = await Promise.all([
        getGranule({ prefix: config.stackName, granuleId: dbGranuleId, collectionId }),
        getGranule({ prefix: config.stackName, granuleId: publishedGranuleId, collectionId }),
      ]);
      console.log('XXXX Waiting for granules updated in list');
      await Promise.all([
        waitForGranuleRecordUpdatedInList(config.stackName, dbGranule),
        waitForGranuleRecordUpdatedInList(config.stackName, granuleAfterUpdate),
      ]);
    } catch (error) {
      console.log(error);
      beforeAllFailed = error;
    }
  });

  it('prepares the test suite successfully', () => {
    if (beforeAllFailed) fail(beforeAllFailed);
  });

  // TODO: fix tests in CUMULUS-3806 when CreateReconciliationReport lambda is changed to query postgres
  xdescribe('Create an Inventory Reconciliation Report to monitor inventory discrepancies', () => {
    // report record in db and report in s3
    let reportRecord;
    let report;
    let inventoryReportAsyncOperationId;

    afterAll(async () => {
      if (inventoryReportAsyncOperationId) {
        await deleteAsyncOperation({ prefix: config.stackName, asyncOperationId: inventoryReportAsyncOperationId });
      }
    });

    it('generates an async operation through the Cumulus API', async () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      const response = await reconciliationReportsApi.createReconciliationReport({
        prefix: config.stackName,
        request: {
          collectionId: [
            constructCollectionId(collection.name, collection.version),
            constructCollectionId(extraCumulusCollection.name, extraCumulusCollection.version),
            constructCollectionId(onlyCMRCollection.name, onlyCMRCollection.version),
          ],
          reportType: 'Granule Not Found',
        },
      });

      const responseBody = JSON.parse(response.body);
      inventoryReportAsyncOperationId = responseBody.id;
      console.log('inventoryReportAsyncOperationId', inventoryReportAsyncOperationId);
      expect(response.statusCode).toBe(202);
    });

    it('generates reconciliation report through the Cumulus API', async () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      let asyncOperation;
      try {
        asyncOperation = await waitForAsyncOperationStatus({
          id: inventoryReportAsyncOperationId,
          status: 'SUCCEEDED',
          stackName: config.stackName,
          retryOptions: {
            retries: 80,
            factor: 1.041,
          },
        });
      } catch (error) {
        fail(error);
      }
      expect(asyncOperation.status).toEqual('SUCCEEDED');
      expect(asyncOperation.operationType).toBe('Reconciliation Report');
      reportRecord = JSON.parse(asyncOperation.output);
      expect(reportRecord.status).toEqual('Generated');
      console.log(`report Record: ${JSON.stringify(reportRecord)}`);
    });

    it('fetches a reconciliation report through the Cumulus API', async () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      const reportContent = await fetchReconciliationReport(config.stackName, reportRecord.name);
      report = JSON.parse(reportContent);
      expect(report.reportType).toBe('Granule Not Found');
      expect(report.status).toBe('SUCCESS');
    });

    it('generates a filtered report, omitting files that are in S3 but not in the Cumulus files table', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      const extraS3ObjectUri = buildS3Uri(extraS3Object.Bucket, extraS3Object.Key);
      expect(report.filesInCumulus.onlyInS3).not.toContain(extraS3ObjectUri);
      expect(report.filesInCumulus.onlyInS3.length).toBe(0);
    });

    it('generates a report showing cumulus files that are in the Cumulus files table but not in S3', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      const extraFileUri = buildS3Uri(extraFileInDb.bucket, extraFileInDb.key);
      const extraDbUris = report.filesInCumulus.onlyInDb.map((i) => i.uri);
      expect(extraDbUris).toContain(extraFileUri);
    });

    it('generates a filtered report showing requested collections that are in both Cumulus and CMR', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      // MYD13Q1___006 is in both Cumulus and CMR
      expect(report.collectionsInCumulusCmr.okCount).toBe(1);
    });

    it('generates a filtered report showing requested collections that are in Cumulus but not in CMR', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      const extraCollection = constructCollectionId(extraCumulusCollection.name, extraCumulusCollection.version);
      expect(report.collectionsInCumulusCmr.onlyInCumulus).toContain(extraCollection);
      expect(report.collectionsInCumulusCmr.onlyInCumulus).not.toContain(collectionId);
      expect(report.collectionsInCumulusCmr.onlyInCumulus.length).toBe(1);
    });

    it('generates a report showing the amount of files that match broken down by Granule', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      const okCount = report.filesInCumulus.okCount;
      const totalOkCountByGranule = Object.values(report.filesInCumulus.okCountByGranule).reduce(
        (total, currentOkCount) => total + currentOkCount
      );
      expect(totalOkCountByGranule).toEqual(okCount);
    });

    it('generates a report showing collections that are in the CMR but not in Cumulus', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      // we know CMR has collections which are not in Cumulus
      expect(report.collectionsInCumulusCmr.onlyInCmr.length).toBe(1);
      expect(report.collectionsInCumulusCmr.onlyInCmr).not.toContain(collectionId);
    });

    it('generates a filtered report showing number of granules that are in both Cumulus and CMR', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      // published granule should in both Cumulus and CMR
      expect(report.granulesInCumulusCmr.okCount).toBe(1);
    });

    it('generates a filtered report showing granules that are in Cumulus but not in CMR', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      // ingested (not published) granule should only in Cumulus
      const cumulusGranuleIds = report.granulesInCumulusCmr.onlyInCumulus.map((gran) => gran.granuleId);
      expect(cumulusGranuleIds).toContain(dbGranuleId);
      expect(cumulusGranuleIds).not.toContain(publishedGranuleId);
      expect(report.granulesInCumulusCmr.onlyInCumulus.length).toBe(2);
    });

    it('generates a report showing granules that are in the CMR but not in Cumulus', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      const cmrGranuleIds = report.granulesInCumulusCmr.onlyInCmr.map((gran) => gran.GranuleUR);
      expect(cmrGranuleIds.length).toBeGreaterThanOrEqual(1);
      expect(cmrGranuleIds).toContain(cmrGranule.granuleId);
      expect(cmrGranuleIds).not.toContain(dbGranuleId);
      expect(cmrGranuleIds).not.toContain(publishedGranuleId);
    });

    it('generates a report showing number of granule files that are in both Cumulus and CMR', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      // published granule should have 2 files in both Cumulus and CMR
      expect(report.filesInCumulusCmr.okCount).toBeGreaterThanOrEqual(2);
    });

    it('generates a report showing granule files that are in Cumulus but not in CMR', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      // published granule should have one file(renamed file) in Cumulus
      const fileNames = report.filesInCumulusCmr.onlyInCumulus.map((file) => file.fileName);
      expect(fileNames).toContain(updatedGranuleFile.fileName);
      expect(fileNames).not.toContain(originalGranuleFile.fileName);
      expect(report.filesInCumulusCmr.onlyInCumulus.filter((file) => file.granuleId === publishedGranuleId).length)
        .toBe(1);
    });

    it('generates a report showing granule files that are in the CMR but not in Cumulus', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      const urls = report.filesInCumulusCmr.onlyInCmr;
      expect(urls.find((url) => url.URL.endsWith(originalGranuleFile.fileName))).toBeTruthy();
      expect(urls.find((url) => url.URL.endsWith(updatedGranuleFile.fileName))).toBeFalsy();
      // CMR has https URL and S3 URL for the same file
      expect(report.filesInCumulusCmr.onlyInCmr.filter((file) => file.GranuleUR === publishedGranuleId).length)
        .toBe(2);
    });

    it('deletes a reconciliation report through the Cumulus API', async () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      await reconciliationReportsApi.deleteReconciliationReport({
        prefix: config.stackName,
        name: reportRecord.name,
      });

      const parsed = parseS3Uri(reportRecord.location);
      const exists = await fileExists(parsed.Bucket, parsed.Key);
      expect(exists).toBeFalse();

      let responseError;

      try {
        await reconciliationReportsApi.getReconciliationReport({
          prefix: config.stackName,
          name: reportRecord.name,
        });
      } catch (error) {
        responseError = error;
      }

      expect(responseError.statusCode).toBe(404);
      expect(JSON.parse(responseError.apiMessage).message).toBe(`No record found for ${reportRecord.name}`);
    });
  });

  describe('Creates \'Granule Inventory\' reports.', () => {
    let reportRecord;
    let reportArray;
    let granuleInventoryAsyncOpId;

    afterAll(async () => {
      if (granuleInventoryAsyncOpId) {
        await deleteAsyncOperation({ prefix: config.stackName, asyncOperationId: granuleInventoryAsyncOpId });
      }
    });

    it('generates an async operation through the Cumulus API', async () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      const request = {
        reportType: 'Granule Inventory',
        reportName: randomId('granuleInventory'),
        startTimestamp,
        endTimestamp: moment.utc().format(),
        collectionId,
        status: 'completed',
        granuleId: [publishedGranuleId, dbGranuleId],
        provider: `s3_provider${testSuffix}`,
      };
      const response = await reconciliationReportsApi.createReconciliationReport({
        prefix: config.stackName,
        request,
      });

      const responseBody = JSON.parse(response.body);
      granuleInventoryAsyncOpId = responseBody.id;
      console.log('granuleInventoryAsyncOpId', granuleInventoryAsyncOpId);
      expect(response.statusCode).toBe(202);
    });

    it('generates reconciliation report through the Cumulus API', async () => {
      if (beforeAllFailed) fail(beforeAllFailed);

      let asyncOperation;
      try {
        asyncOperation = await waitForAsyncOperationStatus({
          id: granuleInventoryAsyncOpId,
          status: 'SUCCEEDED',
          stackName: config.stackName,
          retryOptions: {
            retries: 70,
            factor: 1.041,
          },
        });
      } catch (error) {
        fail(error);
      }

      expect(asyncOperation.operationType).toBe('Reconciliation Report');
      reportRecord = JSON.parse(asyncOperation.output);
    });

    it('Fetches an object with a signedURL to the Granule Inventory report through the Cumulus API', async () => {
      if (beforeAllFailed) fail(beforeAllFailed);

      const reportContent = await fetchReconciliationReport(config.stackName, reportRecord.name);
      reportArray = reportContent.split('\n');
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
      if (beforeAllFailed) fail(beforeAllFailed);

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
      if (beforeAllFailed) fail(beforeAllFailed);
      await reconciliationReportsApi.deleteReconciliationReport({
        prefix: config.stackName,
        name: reportRecord.name,
      });

      const parsed = parseS3Uri(reportRecord.location);
      const exists = await fileExists(parsed.Bucket, parsed.Key);
      expect(exists).toBeFalse();

      let responseError;
      try {
        await reconciliationReportsApi.getReconciliationReport({
          prefix: config.stackName,
          name: reportRecord.name,
        });
      } catch (error) {
        responseError = error;
      }
      expect(responseError.statusCode).toBe(404);
      expect(JSON.parse(responseError.apiMessage).message).toBe(`No record found for ${reportRecord.name}`);
    });
  });

  // TODO: fix tests in CUMULUS-3806 when CreateReconciliationReport lambda is changed to query postgres
  describe('Create an ORCA Backup Reconciliation Report to monitor ORCA backup discrepancies', () => {
    // report record in db and report in s3
    let reportRecord;
    let report;
    let orcaReportAsyncOperationId;

    afterAll(async () => {
      if (orcaReportAsyncOperationId) {
        await deleteAsyncOperation({ prefix: config.stackName, asyncOperationId: orcaReportAsyncOperationId });
      }
    });

    it('generates an async operation through the Cumulus API', async () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      const request = {
        reportType: 'ORCA Backup',
        reportName: randomId('OrcaBackupReport'),
        startTimestamp,
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
      orcaReportAsyncOperationId = responseBody.id;
      console.log('orcaReportAsyncOperationId', orcaReportAsyncOperationId);
      expect(response.statusCode).toBe(202);
    });

    it('generates reconciliation report through the Cumulus API', async () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      let asyncOperation;
      try {
        asyncOperation = await waitForAsyncOperationStatus({
          id: orcaReportAsyncOperationId,
          status: 'SUCCEEDED',
          stackName: config.stackName,
          retryOptions: {
            retries: 60,
            factor: 1.08,
          },
        });
      } catch (error) {
        fail(error);
      }
      expect(asyncOperation.operationType).toBe('Reconciliation Report');
      reportRecord = JSON.parse(asyncOperation.output);
    });

    it('fetches a reconciliation report through the Cumulus API', async () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      const reportContent = await fetchReconciliationReport(config.stackName, reportRecord.name);
      report = JSON.parse(reportContent);
      console.log(`ORCA Backup report ${reportContent}`);
      expect(report.reportType).toBe('ORCA Backup');
      expect(report.status).toBe('SUCCESS');
    });

    it('generates a report showing number of granules that are in Cumulus and ORCA', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      const granules = report.granules;
      expect(granules).toBeTruthy();
      expect(granules.okCount).toBe(0);
      // publishedGranule, dbGranule
      expect(granules.cumulusCount).toBe(2);
      // publishedGranule
      expect(granules.orcaCount).toBe(1);
      // 4 from publishedGranule (all except .jpg, .jpg2), 1 from dbGranule (.met)
      expect(granules.okFilesCount).toBe(5);
      // all 5 from publishedGranule, all 5 from dbGranule
      expect(granules.cumulusFilesCount).toBe(10);
      // 4 from publishedGranule (except .met)
      expect(granules.orcaFilesCount).toBe(4);
      expect(granules.conflictFilesCount).toBe(6);
      expect(granules.onlyInCumulus.length).toBe(1);
      expect(granules.onlyInCumulus[0].granuleId).toBe(dbGranuleId);
      expect(granules.onlyInCumulus[0].collectionId).toBe(collectionId);
      expect(granules.onlyInCumulus[0].provider).toBe(`s3_provider${testSuffix}`);
      expect(granules.onlyInCumulus[0].okFilesCount).toBe(1);
      expect(granules.onlyInCumulus[0].cumulusFilesCount).toBe(5);
      expect(granules.onlyInCumulus[0].orcaFilesCount).toBe(0);
      expect(granules.onlyInCumulus[0].conflictFiles.length).toBe(4);
      expect(granules.onlyInCumulus[0].conflictFiles.filter((file) => file.fileName.endsWith('.met')).length).toBe(0);
      expect(granules.onlyInOrca.length).toBe(0);
      if (granules.withConflicts.length !== 0) {
        console.log(`XXXX withConflicts ${JSON.stringify(granules.withConflicts)}`);
      }
      expect(granules.withConflicts.length).toBe(1);
      expect(granules.withConflicts[0].granuleId).toBe(publishedGranuleId);
      expect(granules.withConflicts[0].collectionId).toBe(collectionId);
      expect(granules.withConflicts[0].provider).toBe(`s3_provider${testSuffix}`);
      expect(granules.withConflicts[0].okFilesCount).toBe(4);
      expect(granules.withConflicts[0].cumulusFilesCount).toBe(5);
      expect(granules.withConflicts[0].orcaFilesCount).toBe(4);
      expect(granules.withConflicts[0].conflictFiles.length).toBe(2);
      expect(granules.withConflicts[0].conflictFiles.filter(
        (file) => file.fileName.endsWith('.jpg') || file.fileName.endsWith('.jpg2')
      ).length).toBe(2);
    });

    it('deletes a reconciliation report through the Cumulus API', async () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      await reconciliationReportsApi.deleteReconciliationReport({
        prefix: config.stackName,
        name: reportRecord.name,
      });

      const parsed = parseS3Uri(reportRecord.location);
      const exists = await fileExists(parsed.Bucket, parsed.Key);
      expect(exists).toBeFalse();

      let responseError;
      try {
        await reconciliationReportsApi.getReconciliationReport({
          prefix: config.stackName,
          name: reportRecord.name,
        });
      } catch (error) {
        responseError = error;
      }

      expect(responseError.statusCode).toBe(404);
      expect(JSON.parse(responseError.apiMessage).message).toBe(`No record found for ${reportRecord.name}`);
    });
    // TODO delete granule from ORCA when the API is available
  });

  afterAll(async () => {
    const activeCollectionId = constructCollectionId(extraCumulusCollection.name, extraCumulusCollection.version);

    console.log(`update database state back for  ${publishedGranuleId}, ${activeCollectionId}`);
    await updateGranule({
      prefix: config.stackName,
      granuleId: publishedGranuleId,
      collectionId: granuleBeforeUpdate.collectionId,
      body: {
        granuleId: publishedGranuleId,
        ...granuleBeforeUpdate,
      },
    });

    const cleanupResults = await Promise.allSettled([
      removeCollectionAndAllDependencies({ prefix: config.stackName, collection: extraCumulusCollection }),
      removeCollectionAndAllDependencies({ prefix: config.stackName, collection }),
      s3().deleteObject(extraS3Object),
      deleteFolder(config.bucket, testDataFolder),
      cmrClient.deleteGranule(cmrGranule),
    ]);
    cleanupResults.forEach((result) => {
      if (result.status === 'rejected') {
        console.log(`***Cleanup failed ${JSON.stringify(result)}`);
        throw new Error(JSON.stringify(result));
      }
    });
    await cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix);
  });
});

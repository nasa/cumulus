'use strict';

const cryptoRandomString = require('crypto-random-string');

const fs = require('fs-extra');
const path = require('path');
const pMap = require('p-map');
const pRetry = require('p-retry');
const { URL, resolve } = require('url');

const difference = require('lodash/difference');
const get = require('lodash/get');
const includes = require('lodash/includes');
const intersection = require('lodash/intersection');
const isObject = require('lodash/isObject');

const {
  Execution,
  Granule,
  Pdr,
} = require('@cumulus/api/models');
const GranuleFilesCache = require('@cumulus/api/lib/GranuleFilesCache');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const { pullStepFunctionEvent } = require('@cumulus/message/StepFunctions');
const {
  deleteS3Object,
  parseS3Uri,
  s3CopyObject,
  s3GetObjectTagging,
  s3ObjectExists,
} = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const { generateChecksumFromStream } = require('@cumulus/checksum');
const { randomId } = require('@cumulus/common/test-utils');
const { isCMRFile, metadataObjectFromCMRFile } = require('@cumulus/cmrjs/cmr-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');
const {
  addCollections,
  buildAndExecuteWorkflow,
  buildAndStartWorkflow,
  conceptExists,
  getExecutionOutput,
  getOnlineResources,
  waitForAsyncOperationStatus,
  waitForConceptExistsOutcome,
  waitForTestExecutionStart,
  waitForCompletedExecution,
} = require('@cumulus/integration-tests');
const apiTestUtils = require('@cumulus/integration-tests/api/api');
const { deleteCollection } = require('@cumulus/api-client/collections');
const executionsApiTestUtils = require('@cumulus/api-client/executions');
const providersApi = require('@cumulus/api-client/providers');
const granulesApiTestUtils = require('@cumulus/api-client/granules');
const {
  getDistributionFileUrl,
  getTEADistributionApiRedirect,
  getTEADistributionApiFileStream,
  getTEARequestHeaders,
} = require('@cumulus/integration-tests/api/distribution');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');

const {
  loadConfig,
  templateFile,
  uploadTestDataToBucket,
  deleteFolder,
  getExecutionUrl,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
  getFilesMetadata,
} = require('../../helpers/testUtils');
const {
  setDistributionApiEnvVars,
  waitForModelStatus,
} = require('../../helpers/apiUtils');
const {
  addUniqueGranuleFilePathToGranuleFiles,
  addUrlPathToGranuleFiles,
  setupTestGranuleForIngest,
  loadFileWithUpdatedGranuleIdPathAndCollection,
} = require('../../helpers/granuleUtils');

const { isReingestExecutionForGranuleId } = require('../../helpers/workflowUtils');

const lambdaStep = new LambdaStep();
const workflowName = 'IngestAndPublishGranule';

const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg',
];

function isExecutionForGranuleId(taskInput, params) {
  return taskInput.payload.granules && taskInput.payload.granules[0].granuleId === params.granuleId;
}

describe('The S3 Ingest Granules workflow', () => {
  const inputPayloadFilename = './spec/parallel/ingestGranule/IngestGranule.input.payload.json';
  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006_full_ingest';
  const collectionDupeHandling = 'error';

  let collection;
  let config;
  let executionModel;
  let expectedPayload;
  let expectedS3TagSet;
  let granuleModel;
  let inputPayload;
  let pdrModel;
  let postToCmrOutput;
  let provider;
  let testDataFolder;
  let workflowExecutionArn;
  let failingWorkflowExecution;
  let granuleCompletedMessageKey;
  let granuleRunningMessageKey;
  let opendapFilePath;
  let beforeAllFailed = false;

  beforeAll(async () => {
    try {
      config = await loadConfig();

      const testId = createTimestampedTestId(config.stackName, 'IngestGranuleSuccess') + cryptoRandomString({ length: 10 });
      const testSuffix = createTestSuffix(testId);
      testDataFolder = createTestDataPath(testId);

      collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
      const newCollectionId = constructCollectionId(collection.name, collection.version);
      provider = { id: `s3_provider${testSuffix}` };

      process.env.GranulesTable = `${config.stackName}-GranulesTable`;
      granuleModel = new Granule();
      process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
      executionModel = new Execution();
      process.env.system_bucket = config.bucket;
      process.env.ProvidersTable = `${config.stackName}-ProvidersTable`;
      process.env.PdrsTable = `${config.stackName}-PdrsTable`;
      pdrModel = new Pdr();

      const providerJson = JSON.parse(fs.readFileSync(`${providersDir}/s3_provider.json`, 'utf8'));
      const providerData = {
        ...providerJson,
        id: provider.id,
        host: config.bucket,
      };

      // populate collections, providers and test data
      await Promise.all([
        uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
        addCollections(config.stackName, config.bucket, collectionsDir, testSuffix, testId, collectionDupeHandling),
        apiTestUtils.addProviderApi({ prefix: config.stackName, provider: providerData }),
      ]);

      const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
      // update test data filepaths
      inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, testSuffix, testDataFolder);
      const granuleId = inputPayload.granules[0].granuleId;
      expectedS3TagSet = [{ Key: 'granuleId', Value: granuleId }];
      await Promise.all(inputPayload.granules[0].files.map((fileToTag) =>
        s3().putObjectTagging({ Bucket: config.bucket, Key: `${fileToTag.path}/${fileToTag.name}`, Tagging: { TagSet: expectedS3TagSet } }).promise()));

      const collectionUrlString = '{cmrMetadata.Granule.Collection.ShortName}___{cmrMetadata.Granule.Collection.VersionId}/{substring(file.name, 0, 3)}/';

      const templatedSyncGranuleFilename = templateFile({
        inputTemplateFilename: './spec/parallel/ingestGranule/SyncGranule.output.payload.template.json',
        config: {
          granules: [
            {
              files: [
                {
                  bucket: config.buckets.internal.name,
                  filename: `s3://${config.buckets.internal.name}/file-staging/${config.stackName}/replace-me-collectionId/replace-me-granuleId.hdf`,
                  fileStagingDir: `file-staging/${config.stackName}/replace-me-collectionId`,
                },
                {
                  bucket: config.buckets.internal.name,
                  filename: `s3://${config.buckets.internal.name}/file-staging/${config.stackName}/replace-me-collectionId/replace-me-granuleId.hdf.met`,
                  fileStagingDir: `file-staging/${config.stackName}/replace-me-collectionId`,
                },
                {
                  bucket: config.buckets.internal.name,
                  filename: `s3://${config.buckets.internal.name}/file-staging/${config.stackName}/replace-me-collectionId/replace-me-granuleId_ndvi.jpg`,
                  fileStagingDir: `file-staging/${config.stackName}/replace-me-collectionId`,
                },
              ],
            },
          ],
        },
      });

      // process.env.DISTRIBUTION_ENDPOINT needs to be set for below
      setDistributionApiEnvVars();

      console.log('We would start execution here, but right now we just. don\'t care');
      /* workflowExecutionArn = await buildAndStartWorkflow(
        config.stackName,
        config.bucket,
        workflowName,
        collection,
        provider,
        inputPayload,
        {
          distribution_endpoint: process.env.DISTRIBUTION_ENDPOINT,
        }
      ); */
      opendapFilePath = `https://opendap.uat.earthdata.nasa.gov/collections/C1218668453-CUMULUS/granules/${granuleId}`;
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  afterAll(async () => {
    // clean up stack state added by test
    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      deleteCollection({
        prefix: config.stackName,
        collectionName: collection.name,
        collectionVersion: collection.version,
      }),
      providersApi.deleteProvider({
        prefix: config.stackName,
        provider: { id: provider.id },
      }),
      pdrModel.delete({
        pdrName: inputPayload.pdr.name,
      }),
    ]);
  });

  it('prepares the test suite successfully', async () => {
    if (beforeAllFailed) fail('beforeAll() failed to prepare test suite');
  });
});

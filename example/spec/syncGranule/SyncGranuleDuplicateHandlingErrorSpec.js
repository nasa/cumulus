const fs = require('fs');
const path = require('path');
const { Collection } = require('@cumulus/api/models');
const {
  constructCollectionId,
  stringUtils: { globalReplace }
} = require('@cumulus/common');
const {
  addCollections,
  buildAndExecuteWorkflow,
  LambdaStep,
  deleteCollections,
  listCollections,
  api: apiTestUtils
} = require('@cumulus/integration-tests');

const { setupTestGranuleForIngest } = require('../helpers/granuleUtils');
const {
  loadConfig,
  timestampedTestDataPrefix,
  deleteFolder,
  uploadTestDataToBucket
} = require('../helpers/testUtils');
const config = loadConfig();
const lambdaStep = new LambdaStep();

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf'
];
const duplicateHandlingSuffix = 'duplicateHandlingError';
const collectionsDirectory = './data/collections/syncGranule/duplicateHandlingError';
const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
const testDataGranuleId = 'MOD09GQ.A2016358.h13v04.006.2016360104606';

describe('The Sync Granules workflow is configured to handle duplicates as "error"', () => {
  const testDataFolder = timestampedTestDataPrefix(`${config.stackName}-SyncGranuleDuplicateHandlingError`);
  const inputPayloadFilename = './spec/syncGranule/SyncGranuleDuplicateHandling.input.payload.json';
  const collection = { name: `MOD09GQ_${duplicateHandlingSuffix}`, version: '006' };
  const provider = { id: 's3_provider' };
  const fileStagingDir = 'custom-staging-dir';
  const taskName = 'SyncGranule';
  let destFileDir;
  let existingFileKey;
  let inputPayload;
  let granuleFileName;
  let workflowExecution;

  const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
  // update test data filepaths
  let updatedInputPayloadJson = globalReplace(inputPayloadJson, 'cumulus-test-data/pdrs', testDataFolder);
  updatedInputPayloadJson = globalReplace(inputPayloadJson, '{{duplicateHandlingSuffix}}', duplicateHandlingSuffix);

  process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
  const c = new Collection();

  beforeAll(async () => {
    // Upload test data to be synced for this spec
    await uploadTestDataToBucket(config.bucket, s3data, testDataFolder);

    // Create test granule
    inputPayload = await setupTestGranuleForIngest(config.bucket, updatedInputPayloadJson, testDataGranuleId, granuleRegex);
    granuleFileName = inputPayload.granules[0].files[0].name;

    // Create collection with "duplicateHandling" of "error"
    await addCollections(config.stackName, config.bucket, collectionsDirectory);

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName, config.bucket, taskName, collection, provider, inputPayload
    );

    const collectionInfo = await c.get(collection);
    destFileDir = path.join(
      fileStagingDir,
      config.stackName,
      constructCollectionId(collectionInfo.dataType, collectionInfo.version)
    );
    existingFileKey = path.join(
      destFileDir,
      granuleFileName
    );
  });

  afterAll(async () => {
    const collections = await listCollections(config.stackName, config.bucket, collectionsDirectory);
    await Promise.all([
      // delete ingested granule
      apiTestUtils.deleteGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      }),
      // delete test collection
      deleteCollections(config.stackName, config.bucket, collections),
      // cleanup folders used by test
      deleteFolder(config.bucket, testDataFolder),
      deleteFolder(config.bucket, destFileDir)
    ]);
  });

  it('completes the first execution with a success status', async () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('and it is not configured to catch the duplicate error', () => {
    beforeAll(async () => {
      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, taskName, collection, provider, inputPayload
      );
    });

    it('configured collection to handle duplicates as error', async () => {
      const lambdaInput = await lambdaStep.getStepInput(workflowExecution.executionArn, 'SyncGranuleNoVpc');
      expect(lambdaInput.meta.collection.duplicateHandling).toEqual('error');
    });

    it('fails the SyncGranule Lambda function', async () => {
      const lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranuleNoVpc', 'failure');
      const { error, cause } = lambdaOutput;
      const errorCause = JSON.parse(cause);
      expect(error).toEqual('DuplicateFile');
      expect(errorCause.errorMessage).toEqual(
        `${existingFileKey} already exists in ${config.bucket} bucket`
      );
    });

    it('fails the workflow', () => {
      expect(workflowExecution.status).toEqual('FAILED');
    });
  });

  describe('and it is configured to catch the duplicate error', () => {
    const catchTaskName = 'SyncGranuleCatchDuplicateErrorTest';

    beforeAll(async () => {
      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, catchTaskName, collection, provider, inputPayload
      );
    });

    it('configured collection to handle duplicates as error', async () => {
      const lambdaInput = await lambdaStep.getStepInput(workflowExecution.executionArn, 'SyncGranuleNoVpc');
      expect(lambdaInput.meta.collection.duplicateHandling).toEqual('error');
    });

    it('fails the SyncGranule Lambda function', async () => {
      const lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranuleNoVpc', 'failure');
      const { error, cause } = lambdaOutput;
      const errorCause = JSON.parse(cause);
      expect(error).toEqual('DuplicateFile');
      expect(errorCause.errorMessage).toEqual(
        `${existingFileKey} already exists in ${config.bucket} bucket`
      );
    });

    it('completes execution with success status', async () => {
      expect(workflowExecution.status).toEqual('SUCCEEDED');
    });
  });
});

const fs = require('fs');
const path = require('path');
const { Collection } = require('@cumulus/api/models');
const { constructCollectionId } = require('@cumulus/common');
const {
  addCollections,
  addProviders,
  buildAndExecuteWorkflow,
  cleanupCollections,
  cleanupProviders,
  LambdaStep,
  api: apiTestUtils
} = require('@cumulus/integration-tests');

const { setupTestGranuleForIngest } = require('../../helpers/granuleUtils');
const {
  loadConfig,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
  deleteFolder,
  uploadTestDataToBucket
} = require('../../helpers/testUtils');
const config = loadConfig();
const lambdaStep = new LambdaStep();

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf'
];
const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

describe('The Sync Granules workflow is configured to handle duplicates as "error"\n', () => {
  const testId = createTimestampedTestId(config.stackName, 'SyncGranuleDuplicateHandlingError');
  const testSuffix = createTestSuffix(testId);
  const testDataFolder = createTestDataPath(testId);

  const inputPayloadFilename = './spec/parallel/syncGranule/SyncGranuleDuplicateHandling.input.payload.json';

  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';
  const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
  const provider = { id: `s3_provider${testSuffix}` };

  const fileStagingDir = 'custom-staging-dir';
  const workflowName = 'SyncGranule';
  let destFileDir;
  let existingFileKey;
  let inputPayload;
  let granuleFileName;
  let workflowExecution;

  process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
  const c = new Collection();

  beforeAll(async () => {
    try {
    await Promise.all([
      uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix)
    ]);
    // set collection duplicate handling to 'error'
    await c.update(collection, { duplicateHandling: 'error' });

    // Create test granule
    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, testSuffix, testDataFolder);
    granuleFileName = inputPayload.granules[0].files[0].name;

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName, config.bucket, workflowName, collection, provider, inputPayload
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
    }
    catch(e) { console.log(e); }
  });

  afterAll(async () => {
    // cleanup stack state changes added by test
    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      deleteFolder(config.bucket, destFileDir),
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix),
      apiTestUtils.deleteGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      })
    ]);
  });

  it('completes the first execution with a success status', async () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('and it is not configured to catch the duplicate error', () => {
    beforeAll(async () => {
      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, workflowName, collection, provider, inputPayload
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
    const catchWorkflowName = 'SyncGranuleCatchDuplicateErrorTest';

    beforeAll(async () => {
      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, catchWorkflowName, collection, provider, inputPayload
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

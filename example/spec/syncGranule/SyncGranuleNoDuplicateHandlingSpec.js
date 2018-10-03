const fs = require('fs');
const path = require('path');
const { Collection } = require('@cumulus/api/models');
const {
  constructCollectionId
} = require('@cumulus/common');
const {
  addCollections,
  addProviders,
  buildAndExecuteWorkflow,
  LambdaStep,
  cleanupCollections,
  api: apiTestUtils
} = require('@cumulus/integration-tests');

const { setupTestGranuleForIngest } = require('../helpers/granuleUtils');
const {
  loadConfig,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
  deleteFolder,
  uploadTestDataToBucket
} = require('../helpers/testUtils');
const config = loadConfig();
const lambdaStep = new LambdaStep();

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf'
];
const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
const testDataGranuleId = 'MOD09GQ.A2016358.h13v04.006.2016360104606';

describe('The Sync Granules workflow is not configured to handle duplicates', () => {
  const testId = createTimestampedTestId(config.stackName, 'SyncGranuleNoDuplicateHandling');
  const testSuffix = createTestSuffix(testId);
  const testDataFolder = createTestDataPath(testId);

  const inputPayloadFilename = './spec/syncGranule/SyncGranuleDuplicateHandling.input.payload.json';

  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';
  const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
  const provider = { id: `s3_provider${testSuffix}` };
  const fileStagingDir = 'custom-staging-dir';
  const workflowName = 'SyncGranuleNoDuplicateHandlingTest';

  let destFileDir;
  let existingFileKey;
  let inputPayload;
  let granuleFileName;
  let workflowExecution;

  process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
  const collectionModel = new Collection();

  beforeAll(async () => {
    // Upload test data to be synced for this spec
    await Promise.all([
      uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix)
    ]);

    // Create test granule
    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, testDataGranuleId, granuleRegex);
    granuleFileName = inputPayload.granules[0].files[0].name;

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName, config.bucket, workflowName, collection, provider, inputPayload
    );

    const collectionInfo = await collectionModel.get(collection);
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
    await Promise.all([
      // delete test collection
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      // cleanup folders used by test
      deleteFolder(config.bucket, testDataFolder),
      deleteFolder(config.bucket, destFileDir),
      // delete ingested granule
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
    const stepName = 'SyncGranuleNoVpc';

    beforeAll(async () => {
      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, workflowName, collection, provider, inputPayload
      );
    });

    it('has no configuration on the SyncGranule Lambda function for duplicateHandling', async () => {
      const lambdaInput = await lambdaStep.getStepInput(workflowExecution.executionArn, stepName);
      // duplciateHandling for the task is determined either by a value directly on the task
      // configuration or on the collection. If neither of these items are present in the
      // task configuration, this assertion proves that the task is falling back to the default
      // value in the task code, which should be "error".
      //
      // The behavioral assertions below verify that the workflow/task is actually using "error"
      // as the duplicateHandling.
      expect(lambdaInput.workflow_config[stepName].duplicateHandling).toBeUndefined();
      expect(lambdaInput.workflow_config[stepName].collection).toBeUndefined();
    });

    it('fails the SyncGranule Lambda function', async () => {
      const lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, stepName, 'failure');
      const { error, cause } = lambdaOutput;
      const errorCause = JSON.parse(cause);
      expect(error).toEqual('DuplicateFile');
      expect(errorCause.errorMessage).toEqual(
        `${existingFileKey} already exists in ${config.bucket} bucket`
      );
    });

    it('fails the workflow execution', async () => {
      expect(workflowExecution.status).toEqual('FAILED');
    });
  });
});

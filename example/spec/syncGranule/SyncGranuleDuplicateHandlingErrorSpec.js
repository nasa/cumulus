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

const { setupTestGranuleForIngest } = require('../helpers/granuleUtils');
const {
  loadConfig,
  createTimestampedTestId,
  createTestDataPath,
  deleteFolder,
  uploadTestDataToBucket
} = require('../helpers/testUtils');
const config = loadConfig();
const lambdaStep = new LambdaStep();

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf'
];

describe('The Sync Granules workflow is configured to handle duplicates as an error', () => {
  const testId = createTimestampedTestId(config.stackName, 'SyncGranuleDuplicateHandlingError');
  const testSuffix = `_${testId}`;
  const testDataFolder = createTestDataPath(testId);
  const inputPayloadFilename = './spec/syncGranule/SyncGranuleDuplicateHandlingError.input.payload.json';
  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';
  const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
  const provider = { id: `s3_provider${testSuffix}` };
  const catchTaskName = 'SyncGranuleCatchDuplicateErrorTest';
  const taskName = 'SyncGranule';
  const fileStagingDir = 'custom-staging-dir';
  const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
  const testDataGranuleId = 'MOD09GQ.A2016358.h13v04.006.2016360104606';
  let destFileDir;
  let existingFileKey;
  let inputPayload;
  let granuleFileName;

  process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
  const c = new Collection();

  beforeAll(async () => {
    await Promise.all([
      await uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      await addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      await addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix)
    ]);
    // set collection duplicate handling to 'error'
    await c.update(collection, { duplicateHandling: 'error' });

    // Create test granule
    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    // update test data filepaths
    inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, testDataGranuleId, granuleRegex, testSuffix, testDataFolder);
    granuleFileName = inputPayload.granules[0].files[0].name;

    await buildAndExecuteWorkflow(
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
    // cleanup stack state changes added by test
    await Promise.all([
      await deleteFolder(config.bucket, testDataFolder),
      await deleteFolder(config.bucket, destFileDir),
      await cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      await cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix),
      await apiTestUtils.deleteGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      })
    ]);
  });

  it('configured collection to handle duplicates as error', async () => {
    const collectionInfo = await c.get(collection);
    expect(collectionInfo.duplicateHandling).toEqual('error');
  });

  describe('and it is configured to catch the duplicate error', () => {
    let catchWorkflowExecution;

    beforeAll(async () => {
      catchWorkflowExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, catchTaskName, collection, provider, inputPayload
      );
    });

    it('fails the SyncGranule Lambda function', async () => {
      const lambdaOutput = await lambdaStep.getStepOutput(catchWorkflowExecution.executionArn, 'SyncGranuleNoVpc', 'failure');
      const { error, cause } = lambdaOutput;
      const errorCause = JSON.parse(cause);
      expect(error).toEqual('DuplicateFile');
      expect(errorCause.errorMessage).toEqual(
        `${existingFileKey} already exists in ${config.bucket} bucket`
      );
    });

    it('completes execution with success status', async () => {
      expect(catchWorkflowExecution.status).toEqual('SUCCEEDED');
    });
  });

  describe('and it is not configured to catch the duplicate error', () => {
    let failWorkflowExecution;

    beforeAll(async () => {
      failWorkflowExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, taskName, collection, provider, inputPayload
      );
    });

    it('fails the SyncGranule Lambda function', async () => {
      const lambdaOutput = await lambdaStep.getStepOutput(failWorkflowExecution.executionArn, 'SyncGranuleNoVpc', 'failure');
      const { error, cause } = lambdaOutput;
      const errorCause = JSON.parse(cause);
      expect(error).toEqual('DuplicateFile');
      expect(errorCause.errorMessage).toEqual(
        `${existingFileKey} already exists in ${config.bucket} bucket`
      );
    });

    it('fails the workflow', () => {
      expect(failWorkflowExecution.status).toEqual('FAILED');
    });
  });
});

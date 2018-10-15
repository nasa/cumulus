'use strict';

const fs = require('fs-extra');
const { Collection } = require('@cumulus/api/models');
const {
  aws: { parseS3Uri }
} = require('@cumulus/common');
const {
  api: apiTestUtils,
  addCollections,
  addProviders,
  buildAndExecuteWorkflow,
  cleanupCollections,
  cleanupProviders,
  LambdaStep
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

const config = loadConfig();
const lambdaStep = new LambdaStep();
const workflowName = 'IngestGranuleCatchDuplicateErrorTest';

const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg'
];

describe('When the Ingest Granules workflow is configured to handle duplicates as "error"', () => {
  const testId = createTimestampedTestId(config.stackName, 'IngestGranuleDuplicateHandlingErrorCatch');
  const testSuffix = createTestSuffix(testId);
  const testDataFolder = createTestDataPath(testId);
  const inputPayloadFilename = './spec/ingestGranule/IngestGranule.input.payload.json';
  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';
  const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
  const provider = { id: `s3_provider${testSuffix}` };
  let workflowExecution;
  let inputPayload;
  let granulesIngested;

  process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
  const collectionModel = new Collection();

  beforeAll(async () => {
    // populate collections, providers and test data
    await Promise.all([
      uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix)
    ]);

    // set collection duplicate handling to 'error'
    await collectionModel.update(collection, { duplicateHandling: 'error' });

    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    // update test data filepaths
    inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, testSuffix, testDataFolder);

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName, config.bucket, workflowName, collection, provider, inputPayload
    );
  });

  afterAll(async () => {
    // clean up stack state added by test
    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix),
      apiTestUtils.deleteGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId
      })
    ]);
  });

  it('completes execution with success status', async () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
    const lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'MoveGranules');
    granulesIngested = lambdaOutput.payload.granules;
  });

  describe('and it encounters data with a duplicated filename, and it is configured to catch the duplicate error', () => {
    beforeAll(async () => {
      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, workflowName, collection, provider, inputPayload
      );
    });

    it('configured collection to handle duplicates as error', async () => {
      const lambdaInput = await lambdaStep.getStepInput(workflowExecution.executionArn, 'MoveGranules');
      expect(lambdaInput.meta.collection.duplicateHandling).toEqual('error');
    });

    it('fails the MoveGranules Lambda function', async () => {
      const lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'MoveGranules', 'failure');
      const { error, cause } = lambdaOutput;
      const errorCause = JSON.parse(cause);
      expect(error).toEqual('DuplicateFile');

      const expectedErrorMessages = granulesIngested[0].files.map((file) => {
        const parsed = parseS3Uri(file.filename);
        return `${parsed.Key} already exists in ${parsed.Bucket} bucket`;
      });

      expect(expectedErrorMessages.includes(errorCause.errorMessage)).toBe(true);
    });

    it('completes execution with success status', async () => {
      expect(workflowExecution.status).toEqual('SUCCEEDED');
    });
  });
});

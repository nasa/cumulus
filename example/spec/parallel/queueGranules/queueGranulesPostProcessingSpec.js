const fs = require('fs');
const flow = require('lodash/flow');
const replace = require('lodash/fp/replace');

const {
  addCollections,
  addProviders,
  cleanupCollections,
  cleanupProviders,
} = require('@cumulus/integration-tests');
const { randomStringFromRegex } = require('@cumulus/common/test-utils');
const { updateCollection } = require('@cumulus/integration-tests/api/api');
const { deleteExecution, getExecution, searchExecutionsByGranules } = require('@cumulus/api-client/executions');
const { getGranule } = require('@cumulus/api-client/granules');

const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');

const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const {
  loadConfig,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
  deleteFolder,
} = require('../../helpers/testUtils');
const {
  waitForGranuleAndDelete,
} = require('../../helpers/granuleUtils');
const { waitForApiStatus } = require('../../helpers/apiUtils');

const workflowName = 'QueueGranulesPassthrough';
const providersDir = './data/providers/s3/';
const collectionsDir = './data/collections/s3_MOD09GQ_006';

describe('The Queue Granules workflow triggered with a database-schema-compliant (post-sync-granules) granule in the payload that has the createdAt key-value defined', () => {
  let beforeAllFailed;
  let collection;
  let config;
  let inputPayload;
  let lambdaStep;
  let provider;
  let queuedLambdaOutput;
  let queueGranulesExecutionArn;
  let testDataFolder;
  let testSuffix;
  let workflowExecution;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      lambdaStep = new LambdaStep();

      process.env.GranulesTable = `${config.stackName}-GranulesTable`;

      const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

      const testId = createTimestampedTestId(config.stackName, 'QueueGranules');
      testSuffix = createTestSuffix(testId);
      testDataFolder = createTestDataPath(testId);

      const inputPayloadFilename =
        './spec/parallel/queueGranules/QueueGranulesSpecPostProcessing.input.payload.json';

      collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
      provider = { id: `s3_provider${testSuffix}` };

      // populate collections, providers and test data
      await Promise.all([
        addCollections(
          config.stackName,
          config.bucket,
          collectionsDir,
          testSuffix
        ),
        addProviders(
          config.stackName,
          config.bucket,
          providersDir,
          config.bucket,
          testSuffix
        ),
      ]);
      await updateCollection({
        prefix: config.stackName,
        collection,
        updateParams: { duplicateHandling: 'replace' },
      });
      const inputPayloadJson = JSON.parse(fs.readFileSync(inputPayloadFilename, 'utf8'));
      inputPayloadJson.granules[0].files = inputPayloadJson.granules[0].files.map(
        (file) => ({ ...file, bucket: config.bucket })
      );
      const oldGranuleId = inputPayloadJson.granules[0].granuleId;

      // update test data filepaths
      const newGranuleId = randomStringFromRegex(granuleRegex);
      inputPayload = flow([
        JSON.stringify,
        replace(new RegExp(oldGranuleId, 'g'), newGranuleId),
        replace(new RegExp('"MOD09GQ"', 'g'), `"MOD09GQ${testSuffix}"`),
        JSON.parse,
      ])(inputPayloadJson);
      // Add Date.now to test queueGranules behavior
      inputPayload.granules[0].createdAt = Date.now();

      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName,
        config.bucket,
        workflowName,
        collection,
        provider,
        inputPayload
      );

      queueGranulesExecutionArn = workflowExecution.executionArn;
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  afterAll(async () => {
    // Wait to prevent out-of-order writes fouling up cleanup due to
    // no-task step function.   AWS doesn't promise event timing
    // so we're really just defending against the majority of observed
    // cases
    await new Promise((resolve) => setTimeout(resolve, 7500));
    // clean up stack state added by test
    await Promise.all(
      inputPayload.granules.map(async (granule) => {
        await waitForGranuleAndDelete(
          config.stackName,
          granule.granuleId,
          'completed'
        );
      })
    );

    await deleteExecution({
      prefix: config.stackName,
      executionArn: queuedLambdaOutput.payload.running[0],
    });

    await deleteExecution({
      prefix: config.stackName,
      executionArn: queueGranulesExecutionArn,
    });

    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      cleanupCollections(
        config.stackName,
        config.bucket,
        collectionsDir,
        testSuffix
      ),
      cleanupProviders(
        config.stackName,
        config.bucket,
        providersDir,
        testSuffix
      ),
    ]);
  });

  it('completes execution with success status', () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    expect(workflowExecution.status).toEqual('completed');
  });

  describe('the QueueGranules Lambda function', () => {
    it('has expected arns output', async () => {
      if (beforeAllFailed) fail('beforeAll() failed');
      queuedLambdaOutput = await lambdaStep.getStepOutput(
        workflowExecution.executionArn,
        'QueueGranules'
      );
      expect(queuedLambdaOutput.payload.running.length).toEqual(1);
    });
  });

  describe('the reporting lambda has received the CloudWatch step function event and', () => {
    it('the execution records are added to the database', async () => {
      if (beforeAllFailed) fail('beforeAll() failed');
      const queuedRecord = await waitForApiStatus(
        getExecution,
        { prefix: config.stackName, arn: workflowExecution.executionArn },
        'completed'
      );
      const childWorkflowRecord = await waitForApiStatus(
        getExecution,
        { prefix: config.stackName, arn: queuedLambdaOutput.payload.running[0] },
        'completed'
      );
      expect(queuedRecord.status).toEqual('completed');
      expect(childWorkflowRecord.status).toEqual('completed');
    });
  });

  it('the granule is added to the database by the child workflow', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    await Promise.all(
      inputPayload.granules.map(async (granule) => {
        const record = await waitForApiStatus(
          getGranule,
          { prefix: config.stackName, granuleId: granule.granuleId },
          'completed'
        );

        const executionSearchResult = await searchExecutionsByGranules({
          prefix: config.stackName,
          payload: {
            granules: [record],
          },
          query: {
            limit: '2',
          },
        });
        const [execution] = JSON.parse(executionSearchResult.body).results.filter((result) => result.arn === queuedLambdaOutput.payload.running[0]);

        expect(record.status).toEqual('completed');
        expect(execution.arn).toEqual(queuedLambdaOutput.payload.running[0]);
      })
    );
  });
});

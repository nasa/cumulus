'use strict';

const fs = require('fs-extra');
const { models: { Execution, Granule } } = require('@cumulus/api');
const { deleteGranule, getGranule } = require('@cumulus/api-client/granules');
const {
  addCollections,
  addProviders,
  api: apiTestUtils,
  buildAndExecuteWorkflow,
  cleanupCollections,
  cleanupProviders,
  executionsApi: executionsApiTestUtils,
} = require('@cumulus/integration-tests');

const { deleteExecution } = require('@cumulus/api-client/executions');

const {
  waitForModelStatus,
} = require('../../helpers/apiUtils');
const {
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
  deleteFolder,
  loadConfig,
  uploadTestDataToBucket,
} = require('../../helpers/testUtils');
const { setupTestGranuleForIngest } = require('../../helpers/granuleUtils');

const workflowName = 'IngestGranule';
const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg',
];

describe('The Ingest Granule failure workflow', () => {
  const inputPayloadFilename = './spec/parallel/ingestGranule/IngestGranule.input.payload.json';
  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';

  let beforeAllFailed = false;
  let config;
  let executionModel;
  let granuleModel;
  let inputPayload;
  let pdrFilename;
  let testDataFolder;
  let testSuffix;
  let workflowExecution;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      const testId = createTimestampedTestId(config.stackName, 'IngestGranuleFailure');
      testSuffix = createTestSuffix(testId);
      testDataFolder = createTestDataPath(testId);

      const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
      const provider = { id: `s3_provider${testSuffix}` };

      process.env.GranulesTable = `${config.stackName}-GranulesTable`;
      granuleModel = new Granule();

      process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
      executionModel = new Execution();

      // populate collections, providers and test data
      await Promise.all([
        uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
        addCollections(config.stackName, config.bucket, collectionsDir, testSuffix, testId),
        addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix),
      ]);

      const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
      // update test data filepaths
      inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, testSuffix, testDataFolder);
      pdrFilename = inputPayload.pdr.name;

      // add a non-existent file to input payload to cause lambda error
      inputPayload.granules[0].files = [
        {
          name: 'non-existent-file',
          key: 'non-existent-path/non-existent-file',
          bucket: 'non-existent-bucket',
        },
      ];

      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName,
        config.bucket,
        workflowName,
        collection,
        provider,
        inputPayload
      );
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  afterAll(async () => {
    // clean up stack state added by test
    await deleteGranule({
      prefix: config.stackName,
      granuleId: inputPayload.granules[0].granuleId,
    });

    await apiTestUtils.deletePdr({
      prefix: config.stackName,
      pdr: pdrFilename,
    });

    await deleteExecution({ prefix: config.stackName, executionArn: workflowExecution.executionArn });
    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix),
    ]);
  });

  it('completes execution with failure status', () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      expect(workflowExecution.status).toEqual('FAILED');
    }
  });

  describe('When a workflow task is configured to catch a specific error and branch and the error is thrown by a Cumulus task', () => {
    let execution;
    let executionStatus;
    let syncGranFailedDetail;
    let syncGranStepOutput;

    beforeAll(async () => {
      const executionArn = workflowExecution.executionArn;
      const executionStatusResponse = await executionsApiTestUtils.getExecutionStatus({
        prefix: config.stackName,
        arn: executionArn,
      });
      executionStatus = JSON.parse(executionStatusResponse.body);

      // Wait for execution to be failed before getting execution record, so that
      // the record should have the correct status
      await waitForModelStatus(
        executionModel,
        { arn: executionArn },
        'failed'
      );
      execution = await executionsApiTestUtils.getExecution({
        prefix: config.stackName,
        arn: executionArn,
      });
    });

    it('branches appropriately according to the CMA output', () => {
      expect(executionStatus.executionHistory).toBeTruthy();
      const { events } = executionStatus.executionHistory;

      const syncGranuleTaskName = 'SyncGranule';
      const failedStepName = 'WorkflowFailed';

      let choiceVerified = false;
      for (let i = 0; i < events.length; i += 1) {
        const currentEvent = events[i];

        if (currentEvent.type === 'TaskStateExited' &&
          currentEvent.name === syncGranuleTaskName) {
          syncGranStepOutput = JSON.parse(currentEvent.output);
          expect(syncGranStepOutput.exception).toBeTruthy();

          // the previous step has the original error thrown from lambda
          const previousEvent = events[i - 1];
          expect(previousEvent.type).toBe('LambdaFunctionFailed');
          syncGranFailedDetail = previousEvent;

          // get the next task executed
          let nextTask;
          while (!nextTask && i < events.length - 1) {
            i += 1;
            const nextEvent = events[i];
            if (nextEvent.type === 'FailStateEntered' &&
              nextEvent.name) {
              nextTask = nextEvent.name;
            }
          }

          expect(nextTask).toEqual(failedStepName);
          choiceVerified = true;
          break;
        }
      }

      expect(choiceVerified).toBeTrue();
    });

    it('propagates the error message to CMA output for next step', () => {
      const syncGranExceptionCause = JSON.parse(syncGranStepOutput.exception.Cause);
      const syncGranFailedCause = JSON.parse(syncGranFailedDetail.cause);
      expect(syncGranStepOutput.exception.Error).toBe(syncGranFailedDetail.error);
      expect(syncGranExceptionCause).toEqual(syncGranFailedCause);
    });

    it('logs the execution with the error message', () => {
      expect(execution.error.Error).toBe(syncGranFailedDetail.error);
      expect(JSON.parse(execution.error.Cause)).toEqual(JSON.parse(syncGranFailedDetail.cause));
    });

    it('fails the granule with an error object', async () => {
      await waitForModelStatus(
        granuleModel,
        { granuleId: inputPayload.granules[0].granuleId },
        'failed'
      );

      const granule = await getGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId,
      });

      expect(granule.status).toBe('failed');
      expect(granule.error.Error).toBeDefined();
      expect(granule.error.Cause).toBeDefined();
    });
  });
});

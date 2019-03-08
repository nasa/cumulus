'use strict';

const fs = require('fs-extra');
const { models: { Granule } } = require('@cumulus/api');
const {
  addCollections,
  addProviders,
  buildAndExecuteWorkflow,
  cleanupCollections,
  cleanupProviders,
  executionsApi: executionsApiTestUtils,
  granulesApi: granulesApiTestUtils
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  uploadTestDataToBucket,
  deleteFolder,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix
} = require('../../helpers/testUtils');
const { setupTestGranuleForIngest } = require('../../helpers/granuleUtils');
const config = loadConfig();
const workflowName = 'IngestGranule';
const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg'
];

describe('The Ingest Granule failure workflow', () => {
  const testId = createTimestampedTestId(config.stackName, 'IngestGranuleFailure');
  const testSuffix = createTestSuffix(testId);
  const testDataFolder = createTestDataPath(testId);
  const inputPayloadFilename = './spec/parallel/ingestGranule/IngestGranule.input.payload.json';
  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';
  const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
  const provider = { id: `s3_provider${testSuffix}` };
  let workflowExecution = null;
  let inputPayload;

  process.env.GranulesTable = `${config.stackName}-GranulesTable`;
  const granuleModel = new Granule();

  beforeAll(async () => {
    // populate collections, providers and test data
    await Promise.all([
      uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix)
    ]);

    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    // update test data filepaths
    inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, testSuffix, testDataFolder);

    // add a non-existent file to input payload to cause lambda error
    const nonexistentFile = { path: 'non-existent-path', name: 'non-existent-file' };
    inputPayload.granules[0].files.push(nonexistentFile);

    // delete the granule record from DynamoDB if exists
    await granuleModel.delete({ granuleId: inputPayload.granules[0].granuleId });

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      workflowName,
      collection,
      provider,
      inputPayload
    );
  });

  afterAll(async () => {
    // clean up stack state added by test
    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix),
      granulesApiTestUtils.deleteGranule({
        prefix: config.prefix,
        granuleId: inputPayload.granules[0].granuleId
      })
    ]);
  });

  it('completes execution with failure status', () => {
    expect(workflowExecution.status).toEqual('FAILED');
  });

  describe('When a workflow task is configured to catch a specific error and branch and the error is thrown by a Cumulus task', () => {
    let execution;
    let executionStatus;
    let syncGranFailedDetail;
    let syncGranStepOutput;

    beforeAll(async () => {
      const executionArn = workflowExecution.executionArn;
      const executionResponse = await executionsApiTestUtils.getExecution({
        prefix: config.prefix,
        arn: executionArn
      });
      execution = JSON.parse(executionResponse.body);
      const executionStatusResponse = await executionsApiTestUtils.getExecutionStatus({
        prefix: config.prefix,
        arn: executionArn
      });
      executionStatus = JSON.parse(executionStatusResponse.body);
    });

    it('branches appropriately according to the CMA output', async () => {
      expect(executionStatus.executionHistory).toBeTruthy();
      const events = executionStatus.executionHistory.events;

      const syncGranuleNoVpcTaskName = 'SyncGranuleNoVpc';
      const stopStatusTaskName = 'StopStatus';

      let choiceVerified = false;
      for (let i = 0; i < events.length; i += 1) {
        const currentEvent = events[i];

        if (currentEvent.type === 'TaskStateExited' &&
          currentEvent.name === syncGranuleNoVpcTaskName) {
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
            if (nextEvent.type === 'TaskStateEntered' &&
              nextEvent.name) {
              nextTask = nextEvent.name;
            }
          }

          expect(nextTask).toEqual(stopStatusTaskName);
          choiceVerified = true;
          break;
        }
      }

      expect(choiceVerified).toBe(true);
    });

    it('propagates the error message to CMA output for next step', async () => {
      const syncGranExceptionCause = JSON.parse(syncGranStepOutput.exception.Cause);
      const syncGranFailedCause = JSON.parse(syncGranFailedDetail.cause);
      expect(syncGranStepOutput.exception.Error).toBe(syncGranFailedDetail.error);
      expect(syncGranExceptionCause).toEqual(syncGranFailedCause);
    });

    it('logs the execution with the error message', async () => {
      expect(execution.error.Error).toBe(syncGranFailedDetail.error);
      expect(JSON.parse(execution.error.Cause)).toEqual(JSON.parse(syncGranFailedDetail.cause));
    });

    it('fails the granule with the error message', async () => {
      const granuleResponse = await granulesApiTestUtils.getGranule({
        prefix: config.prefix,
        granuleId: inputPayload.granules[0].granuleId
      });
      const granule = JSON.parse(granuleResponse.body);

      expect(granule.status).toBe('failed');
      expect(granule.error.Error).toBe(syncGranFailedDetail.error);
      expect(JSON.parse(granule.error.Cause)).toEqual(JSON.parse(syncGranFailedDetail.cause));
    });
  });
});

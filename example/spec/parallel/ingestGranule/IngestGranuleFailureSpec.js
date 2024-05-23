'use strict';

const fs = require('fs-extra');
const { deleteGranule, getGranule } = require('@cumulus/api-client/granules');
const {
  addCollections,
  addProviders,
  api: apiTestUtils,
  cleanupCollections,
  cleanupProviders,
  executionsApi: executionsApiTestUtils,
} = require('@cumulus/integration-tests');
const { getExecution } = require('@cumulus/api-client/executions');

const { deleteExecution } = require('@cumulus/api-client/executions');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const { waitForApiStatus } = require('../../helpers/apiUtils');
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
  let inputPayload;
  let pdrFilename;
  let testDataFolder;
  let testSuffix;
  let workflowExecution;
  let collectionId;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      const testId = createTimestampedTestId(config.stackName, 'IngestGranuleFailure');
      testSuffix = createTestSuffix(testId);
      testDataFolder = createTestDataPath(testId);

      const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
      const provider = { id: `s3_provider${testSuffix}` };

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

      // add a file with invalid schema (missing path field), and a non-existent file to input payload.
      // .cmr.json is for testing retrieving cmr information when granule is failed
      inputPayload.granules[0].files = [
        {
          key: 'no-path-field/no-path-field-file',
          bucket: config.bucket,
          name: 'no-path-field-file',
        },
        {
          name: 'non-existent-file.cmr.json',
          path: 'non-existent-path',
        },
        ...inputPayload.granules[0].files,
      ];
      collectionId = constructCollectionId(inputPayload.granules[0].dataType, inputPayload.granules[0].version);
      console.log(`testSuffix: ${testSuffix}, granuleId: ${inputPayload.granules[0].granuleId}`);
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
      console.log('IngestGranuleFailure beforeAll caught error', error);
      throw error;
    }
  });

  afterAll(async () => {
    // The granule provided cannot clean up the
    // fake S3 objects, so we expect it to fail
    try {
      await deleteGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId,
        collectionId,
        pRetryOptions: {
          retries: 0,
        },
      });
    } catch (error) {
      console.log(`***error deleteGranule ${error.statusCode} ***${error.apiMessage}`);
      const apiMessage = JSON.parse(error.apiMessage || '{}');
      if (apiMessage.name && apiMessage.name !== 'NoSuchBucket') {
        throw new Error(`Could not complete test cleanup ${error.apiMessage}`);
      }
    }

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
      expect(workflowExecution.status).toEqual('failed');
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
      executionStatus = JSON.parse(executionStatusResponse.body).data;

      // Wait for execution to be failed before getting execution record, so that
      // the record should have the correct status

      await waitForApiStatus(
        getExecution,
        {
          prefix: config.stackName,
          arn: executionArn,
        },
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

    it('The execution error object has the expected values for the Error, failedExecutionStepName and Cause keys', () => {
      expect(execution.error.Error).toBe(syncGranFailedDetail.error);
      expect(execution.error.failedExecutionStepName).toBe('SyncGranule');
      expect(JSON.parse(execution.error.Cause)).toEqual(JSON.parse(syncGranFailedDetail.cause));
    });

    it('fails the granule with a list of errors', async () => {
      await waitForApiStatus(
        getGranule,
        {
          prefix: config.stackName,
          granuleId: inputPayload.granules[0].granuleId,
          collectionId,
        },
        'failed'
      );

      const granule = await getGranule({
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId,
        collectionId,
      });

      expect(granule.status).toBe('failed');
      console.log('IngestGranuleFailure granule.error', granule.error);
      const errors = JSON.parse(granule.error.errors || []);
      expect(errors.length).toBeGreaterThanOrEqual(2);
      errors.forEach((error) => {
        console.log('IngestGranuleFailure error.Error', error.Error);
        console.log('IngestGranuleFailure error.Cause', error.Cause);
        const isSchemaValidationError = (error.Error === 'CumulusMessageAdapterExecutionError') &&
          error.Cause.includes('jsonschema.exceptions.ValidationError');
        const isPostgresWriteError = error.Error.includes('Failed writing files to PostgreSQL') &&
          error.Cause.includes('null value in column "bucket" of relation "files" violates not-null constraint');
        expect(isSchemaValidationError || isPostgresWriteError).toBeTrue();
      });
    });
  });
});

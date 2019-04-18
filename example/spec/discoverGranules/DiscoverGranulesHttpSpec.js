'use strict';

const { Execution } = require('@cumulus/api/models');
const {
  api: apiTestUtils,
  addCollections,
  addProviders,
  buildAndExecuteWorkflow,
  cleanupCollections,
  cleanupProviders,
  LambdaStep,
  waitForCompletedExecution
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  createTimestampedTestId,
  createTestSuffix,
  isCumulusLogEntry
} = require('../helpers/testUtils');

const config = loadConfig();
const testId = createTimestampedTestId(config.stackName, 'DiscoverGranules');
const testSuffix = createTestSuffix(testId);
const lambdaStep = new LambdaStep();

const workflowName = 'DiscoverGranules';

jasmine.DEFAULT_TIMEOUT_INTERVAL = 2000000;
process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
const executionModel = new Execution();


describe('The Discover Granules workflow with http Protocol', () => {
  const providersDir = './data/providers/http/';
  const collectionsDir = './data/collections/http_testcollection_001/';
  let httpWorkflowExecution;
  let queueGranulesOutput;

  beforeAll(async () => {
    const collection = { name: `http_testcollection${testSuffix}`, version: '001' };
    const provider = { id: `http_provider${testSuffix}` };
    // populate collections and providers
    await Promise.all([
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      addProviders(config.stackName, config.bucket, providersDir, null, testSuffix)
    ]);

    httpWorkflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      workflowName,
      collection,
      provider
    );

    queueGranulesOutput = await lambdaStep.getStepOutput(
      httpWorkflowExecution.executionArn,
      'QueueGranules'
    );
  });

  afterAll(async () => {
    // clean up stack state added by test
    await Promise.all([
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix)
    ]);
  });

  it('executes successfully', () => {
    expect(httpWorkflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('the DiscoverGranules Lambda', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(
        httpWorkflowExecution.executionArn,
        'DiscoverGranules'
      );
    });
    it('has expected granules output', () => {
      expect(lambdaOutput.payload.granules.length).toEqual(3);
      expect(lambdaOutput.payload.granules[0].granuleId).toEqual('granule-1');
      expect(lambdaOutput.payload.granules[0].files.length).toEqual(2);
      expect(lambdaOutput.payload.granules[0].files[0].fileType).toEqual('data');
    });
  });

  describe('the sf-sns-report task has published a sns message and', () => {
    it('the execution record is added to DynamoDB', async () => {
      const record = await executionModel.get({ arn: httpWorkflowExecution.executionArn });
      expect(record.status).toEqual('completed');
    });
  });

  describe('QueueGranules lambda function', () => {
    it('has expected arns output', () => {
      expect(queueGranulesOutput.payload.running.length).toEqual(3);
    });
  });

  /**
   * The DiscoverGranules workflow queues granule ingest workflows, so check that one of the
   * granule ingest workflow completes successfully.
   */
  describe('IngestGranule workflow', () => {
    let ingestGranuleWorkflowArn;
    let ingestGranuleExecutionStatus;

    beforeAll(async () => {
      ingestGranuleWorkflowArn = queueGranulesOutput.payload.running[0];
      console.log('\nwait for ingestGranuleWorkflow', ingestGranuleWorkflowArn);
      ingestGranuleExecutionStatus = await waitForCompletedExecution(ingestGranuleWorkflowArn);
    });

    it('executes successfully', () => {
      expect(ingestGranuleExecutionStatus).toEqual('SUCCEEDED');
    });

    describe('SyncGranule lambda function', () => {
      it('outputs 1 granule', async () => {
        const lambdaOutput = await lambdaStep.getStepOutput(
          ingestGranuleWorkflowArn,
          'SyncGranule'
        );
        expect(lambdaOutput.payload.granules.length).toEqual(1);
      });
    });

    describe('logs endpoint', () => {
      it('returns the execution logs', async () => {
        const logsResponse = await apiTestUtils.getLogs({ prefix: config.stackName });
        const logs = JSON.parse(logsResponse.body);
        expect(logs).not.toBe(undefined);
        expect(logs.results.length).toEqual(10);
      });

      it('returns logs with sender set', async () => {
        const getLogsResponse = await apiTestUtils.getLogs({ prefix: config.stackName });
        const logs = JSON.parse(getLogsResponse.body);
        const logEntries = logs.results;
        const cumulusLogEntries = logEntries.filter(isCumulusLogEntry);

        cumulusLogEntries.forEach((logEntry) => {
          if (!logEntry.sender) {
            console.log('Expected a sender property:', JSON.stringify(logEntry, null, 2));
          }
          expect(logEntry.sender).not.toBe(undefined);
        });
      });
    });
  });
});

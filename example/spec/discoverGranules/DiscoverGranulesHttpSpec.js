'use strict';

const { Execution } = require('@cumulus/api/models');
const { LambdaStep } = require('@cumulus/common/sfnStep');
const {
  api: apiTestUtils,
  addCollections,
  addProviders,
  buildAndExecuteWorkflow,
  cleanupCollections,
  cleanupProviders,
  waitForCompletedExecution
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  createTimestampedTestId,
  createTestSuffix,
  isCumulusLogEntry
} = require('../helpers/testUtils');

const { waitForModelStatus } = require('../helpers/apiUtils');

const workflowName = 'DiscoverGranules';

jasmine.DEFAULT_TIMEOUT_INTERVAL = 2000000;

describe('The Discover Granules workflow with http Protocol', () => {
  const providersDir = './data/providers/http/';
  const collectionsDir = './data/collections/http_testcollection_001/';

  let config;
  let executionModel;
  let httpWorkflowExecution;
  let lambdaStep;
  let queueGranulesOutput;
  let testId;
  let testSuffix;
  let collection;
  let provider;

  beforeAll(async () => {
    config = await loadConfig();

    process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
    executionModel = new Execution();

    testId = createTimestampedTestId(config.stackName, 'DiscoverGranules');
    testSuffix = createTestSuffix(testId);
    collection = { name: `http_testcollection${testSuffix}`, version: '001' };
    provider = { id: `http_provider${testSuffix}` };

    // populate collections and providers
    await Promise.all([
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      addProviders(config.stackName, config.bucket, providersDir, null, testSuffix)
    ]);

    collection = JSON.parse((await apiTestUtils.getCollection({
      prefix: config.stackName,
      collectionName: collection.name,
      collectionVersion: collection.version
    })).body);

    httpWorkflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      workflowName,
      collection,
      provider
    );

    lambdaStep = new LambdaStep();

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
      expect(lambdaOutput.payload.granules[0].files[0].type).toEqual('data');
    });
  });

  describe('the sf-sns-report task has published a sns message and', () => {
    it('the execution record is added to DynamoDB', async () => {
      const record = await waitForModelStatus(
        executionModel,
        { arn: httpWorkflowExecution.executionArn },
        'completed'
      );
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

  describe('the DiscoverGranules Lambda', () => {
    beforeAll(async () => {
      await apiTestUtils.updateCollection({
        prefix: config.stackName,
        collection,
        updateParams: { files: [] }
      });

      httpWorkflowExecution = await buildAndExecuteWorkflow(config.stackName,
        config.bucket, workflowName, collection, provider);
    });

    it('encounters a collection without a files configuration', async () => {
      const lambdaInput = await lambdaStep.getStepInput(
        httpWorkflowExecution.executionArn, 'DiscoverGranules'
      );

      expect(lambdaInput.meta.collection.files).toEqual([]);
    });

    it('executes successfully', () => {
      expect(httpWorkflowExecution.status).toEqual('SUCCEEDED');
    });

    it('discovers granules, but output has no files', async () => {
      const lambdaOutput = await lambdaStep.getStepOutput(
        httpWorkflowExecution.executionArn, 'DiscoverGranules'
      );

      expect(lambdaOutput.payload.granules.length).toEqual(3);
      lambdaOutput.payload.granules.forEach((granule, i) => {
        expect(granule.granuleId).toEqual(`granule-${i + 1}`);
        expect(granule.files.length).toEqual(0);
      });
    });
  });

  describe('the DiscoverGranules Lambda', () => {
    beforeAll(async () => {
      await apiTestUtils.updateCollection({
        prefix: config.stackName,
        collection,
        updateParams: { files: [collection.files[0]] }
      });

      httpWorkflowExecution = await buildAndExecuteWorkflow(config.stackName,
        config.bucket, workflowName, collection, provider);
    });

    it('encounters a collection with a files configuration that does not match all files', async () => {
      const lambdaInput = await lambdaStep.getStepInput(
        httpWorkflowExecution.executionArn, 'DiscoverGranules'
      );

      expect(lambdaInput.meta.collection.files).toEqual([collection.files[0]]);
    });

    it('executes successfully', () => {
      expect(httpWorkflowExecution.status).toEqual('SUCCEEDED');
    });

    it('discovers granules, but output does not include all files', async () => {
      const lambdaOutput = await lambdaStep.getStepOutput(
        httpWorkflowExecution.executionArn, 'DiscoverGranules'
      );

      expect(lambdaOutput.payload.granules.length).toEqual(3);
      lambdaOutput.payload.granules.forEach((granule, i) => {
        expect(granule.granuleId).toEqual(`granule-${i + 1}`);
        expect(granule.files.length).toEqual(1);
      });
    });
  });

  describe('the DiscoverGranules Lambda', () => {
    beforeAll(async () => {
      await apiTestUtils.updateCollection({
        prefix: config.stackName,
        collection,
        updateParams: {
          files: [],
          ignoreFilesConfigForDiscovery: true
        }
      });

      httpWorkflowExecution = await buildAndExecuteWorkflow(config.stackName,
        config.bucket, workflowName, collection, provider);
    });

    it('encounters a collection that has no files config, but should ignore files config', async () => {
      const lambdaInput = await lambdaStep.getStepInput(
        httpWorkflowExecution.executionArn, 'DiscoverGranules'
      );

      expect(lambdaInput.meta.collection.files).toEqual([]);
    });

    it('executes successfully', () => {
      expect(httpWorkflowExecution.status).toEqual('SUCCEEDED');
    });

    it('discovers granules, but output includes all files', async () => {
      const lambdaOutput = await lambdaStep.getStepOutput(
        httpWorkflowExecution.executionArn, 'DiscoverGranules'
      );

      expect(lambdaOutput.payload.granules.length).toEqual(3);
      lambdaOutput.payload.granules.forEach((granule, i) => {
        expect(granule.granuleId).toEqual(`granule-${i + 1}`);
        expect(granule.files.length).toEqual(2);
      });
    });
  });
});

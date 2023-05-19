const { getExecution, deleteExecution } = require('@cumulus/api-client/executions');
const { deleteProvider } = require('@cumulus/api-client/providers');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const {
  addCollections,
  cleanupCollections,
  waitForCompletedExecution,
} = require('@cumulus/integration-tests');

const { constructCollectionId } = require('@cumulus/message/Collections');
const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const { loadConfig, createTimestampedTestId, createTestSuffix } = require('../../helpers/testUtils');
const { buildHttpOrHttpsProvider, createProvider } = require('../../helpers/Providers');
const { waitForApiStatus } = require('../../helpers/apiUtils');
const { waitForExecutionAndDelete } = require('../../helpers/executionUtils');
const { waitForGranuleAndDelete } = require('../../helpers/granuleUtils');

const workflowName = 'DiscoverGranules';

describe('The Discover Granules workflow with https Protocol', () => {
  const collectionsDir = './data/collections/https_testcollection_001/';
  let httpsWorkflowExecution;

  let collection;
  let config;
  let discoverGranulesLambdaOutput;
  let lambdaStep;
  let provider;
  let queueGranulesOutput;
  let testId;
  let testSuffix;
  let httpsWorkflowExecutionArn;
  let ingestGranuleWorkflowArns;

  beforeAll(async () => {
    config = await loadConfig();

    testId = createTimestampedTestId(config.stackName, 'DiscoverGranulesHttps');
    testSuffix = createTestSuffix(testId);
    collection = { name: `https_testcollection${testSuffix}`, version: '001' };
    provider = await buildHttpOrHttpsProvider(testSuffix, config.bucket, 'https');

    // populate collections and providers
    await Promise.all([
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      createProvider(config.stackName, provider),
    ]);

    httpsWorkflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      workflowName,
      collection,
      provider,
      undefined,
      { provider_path: 'granules/fake_granules' }
    );

    httpsWorkflowExecutionArn = httpsWorkflowExecution.executionArn;

    lambdaStep = new LambdaStep();

    queueGranulesOutput = await lambdaStep.getStepOutput(
      httpsWorkflowExecutionArn,
      'QueueGranules'
    );
  });

  afterAll(async () => {
    // clean up stack state added by test
    await Promise.all(discoverGranulesLambdaOutput.payload.granules.map(
      async (granule) => {
        await waitForGranuleAndDelete(
          config.stackName,
          granule.granuleId,
          constructCollectionId(collection.name, collection.version),
          'completed'
        );
      }
    ));
    await Promise.all(ingestGranuleWorkflowArns.map(
      (executionArn) =>
        waitForExecutionAndDelete(config.stackName, executionArn, 'completed')
    ));

    await deleteExecution({ prefix: config.stackName, executionArn: httpsWorkflowExecutionArn });

    await Promise.all([
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      deleteProvider({ prefix: config.stackName, providerId: provider.id }),
    ]);
  });

  it('executes successfully', () => {
    expect(httpsWorkflowExecution.status).toEqual('completed');
  });

  describe('the DiscoverGranules Lambda', () => {
    let lambdaInput;

    beforeAll(async () => {
      lambdaInput = await lambdaStep.getStepInput(
        httpsWorkflowExecution.executionArn,
        'DiscoverGranules'
      );
      discoverGranulesLambdaOutput = await lambdaStep.getStepOutput(
        httpsWorkflowExecution.executionArn,
        'DiscoverGranules'
      );
    });

    it('has correctly configured provider', () => {
      expect(lambdaInput.meta.provider.protocol).toEqual('https');
    });

    it('has expected granules output', () => {
      expect(discoverGranulesLambdaOutput.payload.granules.length).toEqual(3);
      expect(discoverGranulesLambdaOutput.payload.granules[0].granuleId).toEqual('granule-1');
      expect(discoverGranulesLambdaOutput.payload.granules[0].files.length).toEqual(2);
      expect(discoverGranulesLambdaOutput.payload.granules[0].files[0].type).toEqual('data');
    });
  });

  describe('the reporting lambda has received the cloudwatch stepfunction event and', () => {
    it('the execution record is added to DynamoDB', async () => {
      const record = await waitForApiStatus(
        getExecution,
        {
          prefix: config.stackName,
          arn: httpsWorkflowExecution.executionArn,
        },
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
    let ingestGranuleExecutionStatus;
    let lambdaOutput;

    beforeAll(async () => {
      ingestGranuleWorkflowArns = [
        queueGranulesOutput.payload.running[0],
        queueGranulesOutput.payload.running[1],
        queueGranulesOutput.payload.running[2],
      ];

      console.log('\nwait for ingestGranuleWorkflow', ingestGranuleWorkflowArns[0]);
      ingestGranuleExecutionStatus = await waitForCompletedExecution(ingestGranuleWorkflowArns[0]);
    });

    it('executes successfully', () => {
      expect(ingestGranuleExecutionStatus).toEqual('SUCCEEDED');
    });

    describe('SyncGranule lambda function', () => {
      it('outputs the expected granule', async () => {
        lambdaOutput = await lambdaStep.getStepOutput(
          ingestGranuleWorkflowArns[0],
          'SyncGranule'
        );
        expect(lambdaOutput.payload.granules[0].granuleId).toEqual('granule-1');
        expect(lambdaOutput.payload.granules.length).toEqual(1);
      });
    });
  });
});

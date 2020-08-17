const { Execution } = require('@cumulus/api/models');
const { deleteProvider } = require('@cumulus/api-client/providers');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const {
  addCollections,
  buildAndExecuteWorkflow,
  cleanupCollections,
  granulesApi: granulesApiTestUtils,
  waitForCompletedExecution,
} = require('@cumulus/integration-tests');

const { loadConfig, createTimestampedTestId, createTestSuffix } = require('../../helpers/testUtils');
const { buildHttpOrHttpsProvider, createProvider } = require('../../helpers/Providers');
const { waitForModelStatus } = require('../../helpers/apiUtils');

const workflowName = 'DiscoverGranules';

// Note: This test runs in serial due to the logs endpoint tests

describe('The Discover Granules workflow with https Protocol', () => {
  const collectionsDir = './data/collections/https_testcollection_001/';
  let httpsWorkflowExecution = null;

  let collection;
  let config;
  let executionModel;
  let lambdaStep;
  let provider;
  let queueGranulesOutput;
  let testId;
  let testSuffix;

  beforeAll(async () => {
    config = await loadConfig();

    process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
    executionModel = new Execution();

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

    lambdaStep = new LambdaStep();

    queueGranulesOutput = await lambdaStep.getStepOutput(
      httpsWorkflowExecution.executionArn,
      'QueueGranules'
    );
  });

  afterAll(async () => {
    // clean up stack state added by test
    await Promise.all([
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      deleteProvider({ prefix: config.stackName, providerId: provider.id }),
    ]);
  });

  it('executes successfully', () => {
    expect(httpsWorkflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('the DiscoverGranules Lambda', () => {
    let lambdaInput = null;
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaInput = await lambdaStep.getStepInput(
        httpsWorkflowExecution.executionArn,
        'DiscoverGranules'
      );
      lambdaOutput = await lambdaStep.getStepOutput(
        httpsWorkflowExecution.executionArn,
        'DiscoverGranules'
      );
    });

    afterAll(async () => {
      await Promise.all(lambdaOutput.payload.granules.map(
        (granule) => granulesApiTestUtils.deleteGranule({
          prefix: config.stackName,
          granuleId: granule.granuleId,
        })
      ));
    });

    it('has correctly configured provider', () => {
      expect(lambdaInput.meta.provider.protocol).toEqual('https');
    });

    it('has expected granules output', () => {
      expect(lambdaOutput.payload.granules.length).toEqual(3);
      expect(lambdaOutput.payload.granules[0].granuleId).toEqual('granule-1');
      expect(lambdaOutput.payload.granules[0].files.length).toEqual(2);
      expect(lambdaOutput.payload.granules[0].files[0].type).toEqual('data');
    });
  });

  describe('the reporting lambda has received the cloudwatch stepfunction event and', () => {
    it('the execution record is added to DynamoDB', async () => {
      const record = await waitForModelStatus(
        executionModel,
        { arn: httpsWorkflowExecution.executionArn },
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
  });
});

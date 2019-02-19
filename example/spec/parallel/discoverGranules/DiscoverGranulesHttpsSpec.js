const fs = require('fs-extra');
const { Execution } = require('@cumulus/api/models');
const {
  api: apiTestUtils,
  addCollections,
  buildAndExecuteWorkflow,
  cleanupCollections,
  cleanupProviders,
  granulesApi: granulesApiTestUtils,
  LambdaStep,
  getProviderHost
} = require('@cumulus/integration-tests');

const { loadConfig, createTimestampedTestId, createTestSuffix } = require('../../helpers/testUtils');

const config = loadConfig();
const testId = createTimestampedTestId(config.stackName, 'DiscoverGranules');
const testSuffix = createTestSuffix(testId);
const lambdaStep = new LambdaStep();

const workflowName = 'DiscoverGranules';

jasmine.DEFAULT_TIMEOUT_INTERVAL = 2000000;
process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
const executionModel = new Execution();

// Note: This test runs in serial due to the logs endpoint tests

// Disabled until we're acutally using https
xdescribe('The Discover Granules workflow with https Protocol', () => {
  const providersDir = './data/providers/https/';
  const collectionsDir = './data/collections/https_testcollection_001/';
  let httpsWorkflowExecution = null;

  beforeAll(async () => {
    const collection = { name: `https_testcollection${testSuffix}`, version: '001' };

    const providerJson = JSON.parse(fs.readFileSync(`${providersDir}/https_provider.json`, 'utf8'));

    // we actually want https for this test. we will later update provider to use https
    const provider = Object.assign(providerJson, {
      protocol: 'http',
      host: getProviderHost(providerJson),
      id: `https_provider${testSuffix}`
    });

    // populate collections and providers
    await Promise.all([
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      apiTestUtils.addProviderApi({
        prefix: config.stackName,
        provider
      })
    ]);

    httpsWorkflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      workflowName,
      collection,
      provider
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
          granuleId: granule.granuleId
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
    });
  });

  describe('the sf-sns-report task has published a sns message and', () => {
    it('the execution record is added to DynamoDB', async () => {
      const record = await executionModel.get({ arn: httpsWorkflowExecution.executionArn });
      expect(record.status).toEqual('completed');
    });
  });
});

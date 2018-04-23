const { buildAndExecuteWorkflow, LambdaStep } = require('@cumulus/integration-tests');

const { loadConfig } = require('../helpers/testUtils');

const config = loadConfig();
const lambdaStep = new LambdaStep();

const taskName = 'DiscoverGranules';

jasmine.DEFAULT_TIMEOUT_INTERVAL = 1000000;

describe('The Discover Granules workflow with http Protocol', () => {
  let httpWorkflowExecution;

  beforeAll(async () => {
    const collection = { name: 'http_testcollection', version: '001' };
    const provider = { id: 'http_provider' };

    httpWorkflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      taskName,
      collection,
      provider
    );
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
    });
  });
});

describe('The Discover Granules workflow with https Protocol', () => {
  let httpsWorkflowExecution = null;

  beforeAll(async () => {
    const collection = { name: 'https_testcollection', version: '001' };
    const provider = { id: 'https_provider' };

    httpsWorkflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      taskName,
      collection,
      provider
    );
  });

  it('executes successfully', () => {
    expect(httpsWorkflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('the DiscoverGranules Lambda', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(
        httpsWorkflowExecution.executionArn,
        'DiscoverGranules'
      );
    });

    it('has expected granules output', () => {
      expect(lambdaOutput.payload.granules.length).toEqual(3);
      expect(lambdaOutput.payload.granules[0].granuleId).toEqual('granule-1');
      expect(lambdaOutput.payload.granules[0].files.length).toEqual(2);
    });
  });
});

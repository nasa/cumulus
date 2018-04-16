const { executeWorkflow, LambdaStep } = require('@cumulus/integration-tests');

const { loadConfig, templateFile } = require('../helpers/testUtils');

const config = loadConfig();
const lambdaStep = new LambdaStep();

const taskName = 'DiscoverGranules';
const inputHttpTemplateFilename =
  './spec/discoverGranules/DiscoverGranulesHttp.input.template.json';
const templatedHttpInputFilename = templateFile({
  inputTemplateFilename: inputHttpTemplateFilename,
  config: config[taskName]
});
const inputHttpsTemplateFilename =
  './spec/discoverGranules/DiscoverGranulesHttps.input.template.json';
const templatedHttpsInputFilename = templateFile({
  inputTemplateFilename: inputHttpsTemplateFilename,
  config: config[taskName]
});

jasmine.DEFAULT_TIMEOUT_INTERVAL = 120000;

describe('The Discover Granules workflow with http Protocol', () => {
  let httpWorkflowExecution = null;

  beforeAll(async () => {
    httpWorkflowExecution = await executeWorkflow(
      config.stackName,
      config.bucket,
      taskName,
      templatedHttpInputFilename
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
    httpsWorkflowExecution = await executeWorkflow(
      config.stackName,
      config.bucket,
      taskName,
      templatedHttpsInputFilename
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

const { executeWorkflow, LambdaStep } = require('@cumulus/integration-tests');

const { loadConfig, templateFile } = require('../helpers/testUtils');

const config = loadConfig();
const lambdaStep = new LambdaStep();

const taskName = 'DiscoverGranules';
const inputTemplateFilename = './spec/discoverGranules/DiscoverGranules.input.template.json';
const templatedInputFilename = templateFile({
  inputTemplateFilename,
  config: config[taskName]
});

jasmine.DEFAULT_TIMEOUT_INTERVAL = 120000;

describe("The Discover Granules workflow", function() {
  let workflowExecution = null;

  beforeAll(async function() {
    workflowExecution = await executeWorkflow(
      config.stackName,
      config.bucket,
      taskName,
      templatedInputFilename
    );
  });

  it('executes successfully', function() {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe("the DiscoverGranules Lambda", function() {
    let lambdaOutput = null;

    beforeAll(async function() {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, "DiscoverGranules");
    });

    it("has expected granules output", function() {
      expect(lambdaOutput.payload.granules.length).toEqual(3);
      expect(lambdaOutput.payload.granules[0].granuleId).toEqual('granule-1');
      expect(lambdaOutput.payload.granules[0].files.length).toEqual(2);
    });
  });
});
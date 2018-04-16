const fs = require('fs');
const { executeWorkflow, LambdaStep } = require('@cumulus/integration-tests');

const { loadConfig, templateFile } = require('../helpers/testUtils');
const config = loadConfig();
const lambdaStep = new LambdaStep();
const taskName = 'IngestGranule';

const inputTemplateFilename = './spec/ingestGranule/IngestGranule.input.template.json';
const templatedInputFilename = templateFile({
  inputTemplateFilename,
  config: config[taskName]
});

const outputPayloadTemplateFilename = './spec/ingestGranule/IngestGranule.output.payload.template.json'; // eslint-disable-line max-len
const templatedOutputPayloadFilename = templateFile({
  inputTemplateFilename: outputPayloadTemplateFilename,
  config: config[taskName].SyncGranuleOutput
});
const expectedPayload = JSON.parse(fs.readFileSync(templatedOutputPayloadFilename));

jasmine.DEFAULT_TIMEOUT_INTERVAL = 120000;

describe('The Ingest Granules workflow', () => {
  let workflowExecution = null;

  beforeAll(async () => {
    workflowExecution = await executeWorkflow(
      config.stackName,
      config.bucket,
      taskName,
      templatedInputFilename
    );
  });

  it('executes successfully', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('the SyncGranules Lambda', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
    });

    it('has expected payload', () => {
      expect(lambdaOutput.payload).toEqual(expectedPayload);
    });

    it('has expected updated meta', () => {
      expect(lambdaOutput.meta.input_granules).toEqual(expectedPayload.granules);
    });
  });
});

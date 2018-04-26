const fs = require('fs');
const { buildAndExecuteWorkflow, LambdaStep } = require('@cumulus/integration-tests');

const { loadConfig, templateFile } = require('../helpers/testUtils');
const config = loadConfig();
const lambdaStep = new LambdaStep();
const taskName = 'ProcessAndPublishGranules';

const syncGranuleOutputPayloadTemplateFilename = './spec/processAndPublishGranules/SyncGranule.output.payload.template.json'; // eslint-disable-line max-len
const syncTemplatedOutputPayloadFilename = templateFile({
  inputTemplateFilename: syncGranuleOutputPayloadTemplateFilename,
  config: config.IngestGranule.SyncGranuleOutput
});
const expectedSyncGranulePayload = JSON.parse(fs.readFileSync(syncTemplatedOutputPayloadFilename));


describe('The Ingest, Process and Publish Granules workflow', () => {
  const inputPayloadFilename =
  './spec/processAndPublishGranules/ProcessAndPublishGranules.input.payload.json';
  const inputPayload = JSON.parse(fs.readFileSync(inputPayloadFilename));
  const collection = { name: 'MOD09GQ', version: '006' };
  const provider = { id: 's3_provider' };
  let workflowExecution = null;

  beforeAll(async () => {
    // eslint-disable-next-line function-paren-newline
    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName, config.bucket, taskName, collection, provider, inputPayload);
  });

  it('executes successfully', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('the SyncGranule Lambda function', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
    });

    it('has expected payload', () => {
      expect(lambdaOutput.payload).toEqual(expectedSyncGranulePayload);
    });

    it('has expected updated meta', () => {
      expect(lambdaOutput.meta.input_granules).toEqual(expectedSyncGranulePayload.granules);
    });
  });

  describe('the Fake Processing Lambda function', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'PostToCmr');
    });
    // Stuff
    // Does it have an output with the CMR XML file?
  });

  describe('the Post To CMR Lambda function', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'PostToCmr');
    });
    // Stuff
  });
});

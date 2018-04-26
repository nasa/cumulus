const fs = require('fs');
const { buildAndExecuteWorkflow, LambdaStep } = require('@cumulus/integration-tests');

const { loadConfig, templateFile } = require('../helpers/testUtils');
const config = loadConfig();
const lambdaStep = new LambdaStep();
const taskName = 'ProcessAndPublishGranules';

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

  describe('the workflow', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'SyncGranule');
    });
    // Stuff
  });
});

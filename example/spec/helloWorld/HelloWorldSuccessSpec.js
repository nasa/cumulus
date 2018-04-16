const { executeWorkflow, LambdaStep, ActivityStep } = require('@cumulus/integration-tests');
const { loadConfig } = require('../helpers/testUtils');

const awsConfig = loadConfig();
const lambdaStep = new LambdaStep();
const activityStep = new ActivityStep();

jasmine.DEFAULT_TIMEOUT_INTERVAL = 550000;

describe('The Hello World workflow', () => {
  let workflowExecution = null;

  beforeAll(async () => {
    workflowExecution = await executeWorkflow(
      awsConfig.stackName,
      awsConfig.bucket,
      'HelloWorldWorkflow',
      './spec/helloWorld/HelloWorld.input.template.json'
    );
  });

  it('executes successfully', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('the HelloWorld Lambda', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'HelloWorld');
    });

    it('output is Hello World', () => {
      expect(lambdaOutput.payload).toEqual({ hello: 'Hello World' });
    });
  });
});

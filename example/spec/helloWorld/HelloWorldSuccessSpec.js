const { executeWorkflow, LambdaStep, ActivityStep } = require('@cumulus/integration-tests');
const { loadConfig } = require('../helpers/testUtils');

const awsConfig = loadConfig();
const lambdaStep = new LambdaStep();
const activityStep = new ActivityStep();

jasmine.DEFAULT_TIMEOUT_INTERVAL = 120000;

describe('The Hello World workflow', function() {
  let workflowExecution = null;

  beforeAll(async function() {
    workflowExecution = await executeWorkflow(
      awsConfig.stackName,
      awsConfig.bucket,
      'HelloWorldWorkflow',
      'spec/helloWorld/HelloWorld.input.json'
    );
  });

  it('executes successfully', function() {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('the HelloWorld Lambda', function() {
    let lambdaOutput = null;

    beforeAll(async function() {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'HelloWorld');
    });

    it('output is Hello World', function() {
      expect(lambdaOutput.payload).toEqual({ hello: 'Hello World' });
    });
  });
});

describe('The Hello World workflow using ECS', function() {
  let workflowExecution = null;

  beforeAll(async function() {
    workflowExecution = await executeWorkflow(
      awsConfig.stackName,
      awsConfig.bucket,
      'EcsHelloWorldWorkflow',
      'spec/helloWorld/HelloWorld.input.json'
    );
  });

  it('executes successfully', function() {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('the HelloWorld ECS', function() {
    let activityOutput = null;

    beforeAll(async function() {
      activityOutput = await activityStep.getStepOutput(workflowExecution.executionArn, 'EcsTaskHelloWorld');
    });

    it('output is Hello World', function() {
      expect(activityOutput.payload).toEqual({ hello: 'Hello World' });
    });
  });
});

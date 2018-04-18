const { buildAndExecuteWorkflow, ActivityStep } = require('@cumulus/integration-tests');
const { loadConfig } = require('../helpers/testUtils');

const awsConfig = loadConfig();
const activityStep = new ActivityStep();

jasmine.DEFAULT_TIMEOUT_INTERVAL = 550000;

describe('The Hello World workflow using ECS', () => {
  let workflowExecution = null;

  beforeAll(async () => {
    workflowExecution = await buildAndExecuteWorkflow(
      awsConfig.stackName,
      awsConfig.bucket,
      'EcsHelloWorldWorkflow'
    );
  });

  it('executes successfully', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('the HelloWorld ECS', () => {
    let activityOutput = null;

    beforeAll(async () => {
      activityOutput = await activityStep.getStepOutput(
        workflowExecution.executionArn,
        'EcsTaskHelloWorld'
      );
    });

    it('output is Hello World', () => {
      expect(activityOutput.payload).toEqual({ hello: 'Hello World' });
    });
  });
});

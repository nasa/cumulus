const { Execution } = require('@cumulus/api/models');
const { buildAndExecuteWorkflow, ActivityStep } = require('@cumulus/integration-tests');
const { loadConfig } = require('../../helpers/testUtils');
const { waitForModelStatus } = require('../../helpers/apiUtils');

const awsConfig = loadConfig();
const activityStep = new ActivityStep();


describe('The Hello World workflow using ECS and CMA Layers', () => {
  let workflowExecution = null;
  process.env.ExecutionsTable = `${awsConfig.stackName}-ExecutionsTable`;
  const executionModel = new Execution();

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

  describe('the sf-sns-report task has published a sns message and', () => {
    it('the execution record is added to DynamoDB', async () => {
      const record = await waitForModelStatus(
        executionModel,
        { arn: workflowExecution.executionArn },
        'completed'
      );
      expect(record.status).toEqual('completed');
    });
  });
});

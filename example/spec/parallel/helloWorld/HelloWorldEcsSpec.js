const { Execution } = require('@cumulus/api/models');
const { buildAndExecuteWorkflow } = require('@cumulus/integration-tests');
const { ActivityStep } = require('@cumulus/integration-tests/sfnStep');
const { loadConfig } = require('../../helpers/testUtils');
const { waitForModelStatus } = require('../../helpers/apiUtils');

const activityStep = new ActivityStep();

describe('The Hello World workflow using ECS and CMA Layers', () => {
  let workflowExecution;

  beforeAll(async () => {
    const awsConfig = await loadConfig();

    process.env.ExecutionsTable = `${awsConfig.stackName}-ExecutionsTable`;

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

  describe('the reporting lambda has received the cloudwatch stepfunction event and', () => {
    it('the execution record is added to DynamoDB', async () => {
      const record = await waitForModelStatus(
        new Execution(),
        { arn: workflowExecution.executionArn },
        'completed'
      );
      expect(record.status).toEqual('completed');
    });
  });
});

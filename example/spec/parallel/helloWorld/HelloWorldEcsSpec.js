const { Execution } = require('@cumulus/api/models');
const { deleteExecution } = require('@cumulus/api-client/executions');
const { ActivityStep } = require('@cumulus/integration-tests/sfnStep');
const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const { loadConfig } = require('../../helpers/testUtils');
const { waitForModelStatus } = require('../../helpers/apiUtils');

const activityStep = new ActivityStep();

let config;

describe('The Hello World workflow using ECS and CMA Layers', () => {
  let workflowExecution;

  beforeAll(async () => {
    config = await loadConfig();

    process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      'EcsHelloWorldWorkflow'
    );
  });

  afterAll(async () => {
    await deleteExecution({ prefix: config.stackName, executionArn: workflowExecution.executionArn });
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

const { deleteExecution } = require('@cumulus/api-client/executions');
const { ActivityStep } = require('@cumulus/integration-tests/sfnStep');
const { getExecution } = require('@cumulus/api-client/executions');

const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const { loadConfig } = require('../../helpers/testUtils');
const { waitForApiStatus } = require('../../helpers/apiUtils');

const activityStep = new ActivityStep();

describe('The MoveGranuleCollection workflow using ECS', () => {
  let workflowExecution;
  let config;

  beforeAll(async () => {
    config = await loadConfig();

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      'ECSMoveGranuleCollectionsWorkflow'
    );
  });

  afterAll(async () => {
    await deleteExecution({ prefix: config.stackName, executionArn: workflowExecution.executionArn });
  });

  it('executes successfully', () => {
    expect(workflowExecution.status).toEqual('completed');
  });

  describe('the moveGranuleCollections ECS', () => {
    let activityOutput;

    beforeAll(async () => {
      activityOutput = await activityStep.getStepOutput(
        workflowExecution.executionArn,
        'EcsTaskMoveGranuleCollections'
      );
    });

    it('output is Hello World', () => {
      expect(activityOutput.payload).toEqual({ hello: 'Hello World' });
    });
  });

  describe('the reporting lambda has received the cloudwatch stepfunction event and', () => {
    it('the execution record is added to the PostgreSQL database', async () => {
      const record = await waitForApiStatus(
        getExecution,
        {
          prefix: config.stackName,
          arn: workflowExecution.executionArn,
        },
        'completed'
      );
      expect(record.status).toEqual('completed');
    });
  });
});

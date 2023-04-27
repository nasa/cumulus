'use strict';

const { ActivityStep, LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { deleteExecution } = require('@cumulus/api-client/executions');

const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const { loadConfig } = require('../../helpers/testUtils');

const workflowName = 'PythonReferenceWorkflow';

describe('The Python Reference workflow', () => {
  let config;
  let lambdaStep;
  let activityStep;
  let workflowExecution;

  const initialPayload = {
    initialData: {
      key1: 'value1',
      key2: 'value2',
    },
  };

  beforeAll(async () => {
    config = await loadConfig();

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      workflowName,
      null,
      null,
      initialPayload
    );
    lambdaStep = new LambdaStep();
    activityStep = new ActivityStep();
  });

  afterAll(async () => {
    await deleteExecution({ prefix: config.stackName, executionArn: workflowExecution.executionArn });
  });

  it('executes successfully', () => {
    expect(workflowExecution.status).toEqual('completed');
  });

  it('contains the expected output from the PythonReferenceTask', async () => {
    const stepOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'PythonReferenceTask');
    const expectedPayload = {
      inputData: initialPayload.initialData,
      configInputData: { key1: 'injectedData' },
      newData: { newKey1: 'newData1' },
    };

    expect(stepOutput.payload).toEqual(expectedPayload);
    expect(Object.keys(stepOutput)).toContain('meta');
    expect(Object.keys(stepOutput)).toContain('cumulus_meta');
  });

  it('contains the expected output from the Process Task Activity', async () => {
    const stepOutput = await activityStep.getStepOutput(workflowExecution.executionArn, 'EcsTaskPythonProcess');
    const expectedPayload = {
      fake_output1: 'first fake output',
      fake_output2: 'second fake output',
    };
    expect(stepOutput.payload).toEqual(expectedPayload);
    expect(Object.keys(stepOutput)).toContain('meta');
    expect(Object.keys(stepOutput)).toContain('cumulus_meta');
  });
});

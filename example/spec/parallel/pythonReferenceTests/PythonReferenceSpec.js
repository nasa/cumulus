'use strict';

const workflowName = 'PythonReferenceWorkflow';

const { Execution } = require('@cumulus/api/models');
const { ActivityStep, LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const {
  api: apiTestUtils,
  addCollections,
  addProviders,
  buildAndExecuteWorkflow,
  cleanupCollections,
  cleanupProviders,
  waitForCompletedExecution
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  createTimestampedTestId,
  createTestSuffix,
  isCumulusLogEntry
} = require('../../helpers/testUtils');




describe('The Python Reference workflow', () => {
  let collection;
  let config;
  let lambdaStep;
  let activityStep;
  let provider;
  let testId;
  let testSuffix;
  let workflowExecution;

  const initialPayload = {
    initialData: {
      key1: 'value1',
      key2: 'value2'
    }
  };

  beforeAll(async () => {
    config = await loadConfig();
    process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
    testId = createTimestampedTestId(config.stackName, 'PythonReferenceSpec');
    testSuffix = createTestSuffix(testId);

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

  it('executes successfully', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  it('contains the expected output from the PythonReferenceTask', async () => {
    const stepOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'PythonReferenceTask');
    const expectedPayload = {
      inputData: initialPayload.initialData,
      configInputData: { key1: 'injectedData' },
      newData: { newKey1: 'newData1' }
    };

    expect(stepOutput.payload).toEqual(expectedPayload);
    expect(Object.keys(stepOutput)).toContain('meta');
    expect(Object.keys(stepOutput)).toContain('cumulus_meta');
  });

  it('contains the expected output from the Process Task Activity', async () => {
    const stepOutput = await activityStep.getStepOutput(workflowExecution.executionArn, 'EcsTaskPythonProcess');
    const expectedPayload = {
      fake_output1: 'first fake output',
      fake_output2: 'second fake output'
    };
    expect(stepOutput.payload).toEqual(expectedPayload);
    expect(Object.keys(stepOutput)).toContain('meta');
    expect(Object.keys(stepOutput)).toContain('cumulus_meta');
  });
});

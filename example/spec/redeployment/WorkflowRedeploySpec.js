const {
  buildAndStartWorkflow,
  waitForCompletedExecution,
  api: apiTestUtils
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  redeploy
} = require('../helpers/testUtils');

const {
  backupWorkflowsYml,
  restoreWorkflowsYml,
  removeWorkflow,
  removeTaskFromWorkflow
} = require('../helpers/workflowUtils');

const config = loadConfig();

describe('When a workflow is updated and deployed during a workflow execution', () => {
  let workflowExecutionArn = null;
  let workflowStatus = null;

  beforeAll(async () => {
    backupWorkflowsYml();

    // Kick off the workflow, don't wait for completion
    workflowExecutionArn = await buildAndStartWorkflow(
      config.stackName,
      config.bucket,
      'WaitForDeployWorkflow'
    );

    removeTaskFromWorkflow('WaitForDeployWorkflow', 'HelloWorld');

    await redeploy(config);

    workflowStatus = await waitForCompletedExecution(workflowExecutionArn);
  });

  afterAll(() => {
    restoreWorkflowsYml();
  });

  it('the workflow executes successfully', () => {
    expect(workflowStatus).toEqual('SUCCEEDED');
  });

  describe('When querying the workflow via the API', () => {
    let executionStatus;

    beforeAll(async () => {
      executionStatus = await apiTestUtils.getExecutionStatus({
        prefix: config.stackName,
        arn: workflowExecutionArn
      });
    });

    it('the execution is returned', () => {
      expect(executionStatus.execution).toBeTruthy();
      expect(executionStatus.execution.executionArn).toEqual(workflowExecutionArn);
    });

    it('the execution steps show the original workflow steps', () => {
      const helloWorldScheduledEvents = executionStatus.executionHistory.events.filter((event) =>
        event.type === 'LambdaFunctionScheduled' &&
        event.lambdaFunctionScheduledEventDetails.resource.includes('HelloWorld'));

      expect(helloWorldScheduledEvents.length).toEqual(1);
    });
  });
});

describe('When a workflow is removed and deployed during a workflow execution', () => {
  let workflowExecutionArn = null;
  let workflowStatus = null;

  beforeAll(async () => {
    backupWorkflowsYml();

    // Kick off the workflow, don't wait for completion
    workflowExecutionArn = await buildAndStartWorkflow(
      config.stackName,
      config.bucket,
      'WaitForDeployWorkflow'
    );

    removeWorkflow('WaitForDeployWorkflow');

    await redeploy(config);

    workflowStatus = await waitForCompletedExecution(workflowExecutionArn);
  });

  afterAll(() => {
    restoreWorkflowsYml();
  });

  it('the workflow executes successfully', () => {
    expect(workflowStatus).toEqual('SUCCEEDED');
  });

  describe('When querying the workflow via the API', () => {
    let executionStatus;

    beforeAll(async () => {
      executionStatus = await apiTestUtils.getExecutionStatus({
        prefix: config.stackName,
        arn: workflowExecutionArn
      });
    });

    it('the execution is returned', () => {
      expect(executionStatus.execution).toBeTruthy();
      expect(executionStatus.execution.executionArn).toEqual(workflowExecutionArn);
    });
  });
});

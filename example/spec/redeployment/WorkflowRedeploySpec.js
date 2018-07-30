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
  removeWorkflow
} = require('../helpers/workflowUtils');

const config = loadConfig();

xdescribe('When a workflow is updated and deployed during a workflow execution', () => {

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

    it('the execution is returned', async () => {
      expect(executionStatus.execution).toBeTruthy();
      expect(executionStatus.execution.executionArn).toEqual(workflowExecutionArn);
    });
  });
});

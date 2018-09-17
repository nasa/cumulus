'use strict';

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
  backupConfigYml,
  restoreConfigYml
} = require('../helpers/configUtils');

const {
  removeWorkflow,
  removeTaskFromWorkflow
} = require('../helpers/workflowUtils');

const workflowsYmlFile = './workflows.yml';
const workflowsYmlCopyFile = './workflowsCopy.yml';
const config = loadConfig();


describe('When a workflow', () => {
  beforeAll(async () => {
    backupConfigYml(workflowsYmlFile, workflowsYmlCopyFile);
  });

  afterAll(async () => {
    // Restore workflows.yml to original and redeploy for next time tests are run
    restoreConfigYml(workflowsYmlFile, workflowsYmlCopyFile);
    await redeploy(config);
  });

  describe('is updated and deployed during a workflow execution', () => {
    let workflowExecutionArn = null;
    let workflowStatus = null;

    beforeAll(async () => {
      // Kick off the workflow, don't wait for completion
      workflowExecutionArn = await buildAndStartWorkflow(
        config.stackName,
        config.bucket,
        'WaitForDeployWorkflow'
      );

      removeTaskFromWorkflow('WaitForDeployWorkflow', 'HelloWorld', workflowsYmlFile);

      await redeploy(config);

      workflowStatus = await waitForCompletedExecution(workflowExecutionArn);
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
          event.type === 'LambdaFunctionScheduled'
            && event.lambdaFunctionScheduledEventDetails.resource.includes('HelloWorld'));

        expect(helloWorldScheduledEvents.length).toEqual(1);
      });
    });
  });

  describe('is removed and deployed during a workflow execution', () => {
    let workflowExecutionArn = null;
    let workflowStatus = null;

    beforeAll(async () => {
      // Kick off the workflow, don't wait for completion
      workflowExecutionArn = await buildAndStartWorkflow(
        config.stackName,
        config.bucket,
        'WaitForDeployWorkflow'
      );

      // Remove the WaitForDeployWorkflow workflow from workflows.yml
      removeWorkflow('WaitForDeployWorkflow', workflowsYmlFile);

      await redeploy(config);

      // Wait for the execution to reach a non-RUNNING state
      await waitForCompletedExecution(workflowExecutionArn);

      workflowStatus = await apiTestUtils.getExecution({
        prefix: config.stackName,
        arn: workflowExecutionArn
      });
    });

    it('the workflow has executed successfully and is returned when querying the API', () => {
      expect(workflowStatus).toBeTruthy();
      expect(workflowStatus.arn).toEqual(workflowExecutionArn);
      expect(workflowStatus.status).toEqual('completed');
    });
  });
});

'use strict';

const fs = require('fs');
const { promisify } = require('util');

const {
  buildAndStartWorkflow,
  waitForCompletedExecution,
  api: apiTestUtils
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  redeploy
} = require('../helpers/testUtils');

const { restoreConfigYml } = require('../helpers/configUtils');

const {
  removeWorkflow,
  removeTaskFromWorkflow
} = require('../helpers/workflowUtils');

const workflowsYmlFile = './workflows.yml';
const workflowsYmlCopyFile = './workflowsCopy.yml';
const config = loadConfig();


describe('When a workflow', () => {
  beforeAll(
    () => promisify(fs.copyFile)(workflowsYmlFile, workflowsYmlCopyFile),
    15 * 60 * 1000 // Timeout after 15 minutes
  );

  afterAll(
    () => {
      // Restore workflows.yml to original and redeploy for next time tests are run
      restoreConfigYml(workflowsYmlFile, workflowsYmlCopyFile);
      return redeploy(config);
    },
    15 * 60 * 1000 // Timeout after 15 minutes
  );

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
        console.log(`executionStatus.executionHistory.events ${JSON.stringify(executionStatus.executionHistory.events, null, 2)}`);
        const helloWorldScheduledEvents = executionStatus.executionHistory.events.filter((event) =>
          event.type === 'LambdaFunctionScheduled'
            && event.resource.includes('HelloWorld'));

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

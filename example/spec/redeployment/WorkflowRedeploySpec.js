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
    async () => {
      // Restore workflows.yml to original and redeploy for next time tests are run
      console.log('Starting restoreConfigYml() in afterAll');
      restoreConfigYml(workflowsYmlFile, workflowsYmlCopyFile);
      console.log('Finished restoreConfigYml() in afterAll');

      console.log('Starting redeploy() in afterAll');
      await redeploy(config);
      console.log('Finished redeploy() in afterAll');
    },
    15 * 60 * 1000 // Timeout after 15 minutes
  );

  describe('is updated and deployed during a workflow execution', () => {
    let workflowExecutionArn = null;
    let workflowStatus = null;

    beforeAll(
      async () => {
        // Kick off the workflow, don't wait for completion
        console.log('Starting buildAndStartWorkflow() in beforeAll() A');
        workflowExecutionArn = await buildAndStartWorkflow(
          config.stackName,
          config.bucket,
          'WaitForDeployWorkflow'
        );
        console.log('Finished buildAndStartWorkflow() in beforeAll() A');

        removeTaskFromWorkflow('WaitForDeployWorkflow', 'HelloWorld', workflowsYmlFile);

        console.log('Starting redeploy() in beforeAll() A');
        await redeploy(config);
        console.log('Finished redeploy() in beforeAll() A');

        console.log('Starting waitForCompletedExecution() in beforeAll() A');
        workflowStatus = await waitForCompletedExecution(workflowExecutionArn);
        console.log('Finished waitForCompletedExecution() in beforeAll() A');
      },
      15 * 60 * 1000 // Timeout after 15 minutes
    );

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
            && event.resource.includes('HelloWorld'));

        expect(helloWorldScheduledEvents.length).toEqual(1);
      });
    });
  });

  describe('is removed and deployed during a workflow execution', () => {
    let workflowExecutionArn = null;
    let workflowStatus = null;

    beforeAll(
      async () => {
        // Kick off the workflow, don't wait for completion
        console.log('Starting buildAndStartWorkflow() in beforeAll() B');
        workflowExecutionArn = await buildAndStartWorkflow(
          config.stackName,
          config.bucket,
          'WaitForDeployWorkflow'
        );
        console.log('Finished buildAndStartWorkflow() in beforeAll() B');

        // Remove the WaitForDeployWorkflow workflow from workflows.yml
        removeWorkflow('WaitForDeployWorkflow', workflowsYmlFile);

        console.log('Starting redeploy() in beforeAll() B');
        await redeploy(config);
        console.log('Finished redeploy() in beforeAll() B');

        // Wait for the execution to reach a non-RUNNING state
        console.log('Starting waitForCompletedExecution() in beforeAll() B');
        await waitForCompletedExecution(workflowExecutionArn);
        console.log('Finished waitForCompletedExecution() in beforeAll() B');

        console.log('Starting apiTestUtils.getExecution() in beforeAll() B');
        workflowStatus = await apiTestUtils.getExecution({
          prefix: config.stackName,
          arn: workflowExecutionArn
        });
        console.log('Finished apiTestUtils.getExecution() in beforeAll() B');
      },
      15 * 60 * 1000 // Timeout after 15 minutes
    );

    it('the workflow has executed successfully and is returned when querying the API', () => {
      expect(workflowStatus).toBeTruthy();
      expect(workflowStatus.arn).toEqual(workflowExecutionArn);
      expect(workflowStatus.status).toEqual('completed');
    });
  });
});

'use strict';

const fs = require('fs');
const { promisify } = require('util');
const stepFunctions = require('@cumulus/common/step-functions');

const {
  buildAndStartWorkflow,
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

const promisedFileCopy = promisify(fs.copyFile);

describe('When a workflow', () => {
  beforeAll(() => promisedFileCopy(workflowsYmlFile, workflowsYmlCopyFile));

  afterAll(
    async () => {
      // Restore workflows.yml to original and redeploy for next time tests are run
      restoreConfigYml(workflowsYmlFile, workflowsYmlCopyFile);

      console.log('Starting redeploy() in afterAll'); // Debugging intermittent test failures
      await redeploy(config);
      console.log('Finished redeploy() in afterAll'); // Debugging intermittent test failures
    },
    15 * 60 * 1000 // Timeout after 15 minutes
  );

  describe('is updated and deployed during a workflow execution', () => {
    let workflowExecutionArn = null;
    let workflowStatus = null;

    beforeAll(
      async () => {
        // Kick off the workflow, don't wait for completion
        console.log('Starting buildAndStartWorkflow() in beforeAll() A'); // Debugging intermittent test failures
        workflowExecutionArn = await buildAndStartWorkflow(
          config.stackName,
          config.bucket,
          'WaitForDeployWorkflow'
        );
        console.log('Finished buildAndStartWorkflow() in beforeAll() A'); // Debugging intermittent test failures

        removeTaskFromWorkflow('WaitForDeployWorkflow', 'HelloWorld', workflowsYmlFile);

        console.log('Starting redeploy() in beforeAll() A'); // Debugging intermittent test failures
        await redeploy(config);
        console.log('Finished redeploy() in beforeAll() A'); // Debugging intermittent test failures

        console.log('Starting stepFunctions.getCompletedExecutionStatus() in beforeAll() A'); // Debugging intermittent test failures
        workflowStatus = await stepFunctions.getCompletedExecutionStatus(
          workflowExecutionArn,
          { waitToExist: true }
        );
        console.log('Finished stepFunctions.getCompletedExecutionStatus() in beforeAll() A'); // Debugging intermittent test failures
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
        console.log('Starting buildAndStartWorkflow() in beforeAll() B'); // Debugging intermittent test failures
        workflowExecutionArn = await buildAndStartWorkflow(
          config.stackName,
          config.bucket,
          'WaitForDeployWorkflow'
        );
        console.log('Finished buildAndStartWorkflow() in beforeAll() B'); // Debugging intermittent test failures

        // Remove the WaitForDeployWorkflow workflow from workflows.yml
        removeWorkflow('WaitForDeployWorkflow', workflowsYmlFile);

        console.log('Starting redeploy() in beforeAll() B'); // Debugging intermittent test failures
        await redeploy(config);
        console.log('Finished redeploy() in beforeAll() B'); // Debugging intermittent test failures

        // Wait for the execution to reach a non-RUNNING state
        console.log('Starting stepFunctions.waitForCompletedExecution() in beforeAll() A'); // Debugging intermittent test failures
        await stepFunctions.waitForCompletedExecution(
          workflowExecutionArn,
          { waitToExist: true }
        );
        console.log('Finished stepFunctions.waitForCompletedExecution() in beforeAll() A'); // Debugging intermittent test failures

        console.log('Starting apiTestUtils.getExecution() in beforeAll() B'); // Debugging intermittent test failures
        workflowStatus = await apiTestUtils.getExecution({
          prefix: config.stackName,
          arn: workflowExecutionArn
        });
        console.log('Finished apiTestUtils.getExecution() in beforeAll() B'); // Debugging intermittent test failures
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

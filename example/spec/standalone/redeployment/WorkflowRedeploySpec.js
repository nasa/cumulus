'use strict';

const pRetry = require('p-retry');

const {
  buildAndStartWorkflow,
  waitForCompletedExecution,
  executionsApi: executionsApiTestUtils
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  protectFile,
  redeploy
} = require('../../helpers/testUtils');

const {
  removeWorkflow,
  removeTaskFromWorkflow
} = require('../../helpers/workflowUtils');

const workflowsYmlFile = './workflows.yml';
const config = loadConfig();


const timeout = 30 * 60 * 1000; // Timout for test setup/teardown in milliseconds
const deployTimeout = 15; // deployment timeout in minutes

function redeployWithRetries() {
  return pRetry(
    () => redeploy(config, { timeout: deployTimeout }),
    {
      retries: 2,
      minTimeout: 0
    }
  );
}

describe('When a workflow', () => {
  afterAll(redeployWithRetries);

  describe('is updated and deployed during a workflow execution', () => {
    let workflowExecutionArn;
    let workflowStatus;

    beforeAll(
      async () => {
        // Kick off the workflow, don't wait for completion
        workflowExecutionArn = await buildAndStartWorkflow(
          config.stackName,
          config.bucket,
          'WaitForDeployWorkflow'
        );

        await protectFile(workflowsYmlFile, async () => {
          removeTaskFromWorkflow('WaitForDeployWorkflow', 'HelloWorld', workflowsYmlFile);
          await redeploy(config, { timeout: deployTimeout });
        });

        workflowStatus = await waitForCompletedExecution(workflowExecutionArn);
      },
      timeout
    );

    it('the workflow executes successfully', () => {
      expect(workflowStatus).toEqual('SUCCEEDED');
    });

    describe('When querying the workflow via the API', () => {
      let executionStatus;

      beforeAll(async () => {
        const executionStatusResponse = await executionsApiTestUtils.getExecutionStatus({
          prefix: config.prefix,
          arn: workflowExecutionArn
        });
        executionStatus = JSON.parse(executionStatusResponse.body);
      });

      it('the execution is returned', () => {
        expect(executionStatus.execution).toBeTruthy();
        expect(executionStatus.execution.executionArn).toEqual(workflowExecutionArn);
      });

      it('the execution steps show the original workflow steps', () => {
        const helloWorldScheduledEvents = executionStatus.executionHistory.events.filter((event) =>
          (event.type === 'LambdaFunctionScheduled' &&
          event.resource.includes('HelloWorld')));

        expect(helloWorldScheduledEvents.length).toEqual(1);
      });
    });
  });

  // Disabled per CUMULUS-941
  xdescribe('is removed and deployed during a workflow execution', () => {
    let workflowExecutionArn = null;
    let workflowStatus = null;

    beforeAll(
      async () => {
        // Kick off the workflow, don't wait for completion
        workflowExecutionArn = await buildAndStartWorkflow(
          config.stackName,
          config.bucket,
          'WaitForDeployWorkflow'
        );

        await protectFile(workflowsYmlFile, async () => {
          removeWorkflow('WaitForDeployWorkflow', workflowsYmlFile);
          await redeploy(config, { timeout: deployTimeout });
        });

        workflowStatus = await waitForCompletedExecution(workflowExecutionArn);
      },
      timeout
    );

    xit('the workflow has executed successfully and is returned when querying the API', () => {
      expect(workflowStatus).toBeTruthy();
      expect(workflowStatus.arn).toEqual(workflowExecutionArn);
      expect(workflowStatus.status).toEqual('completed');
    });
  });
});

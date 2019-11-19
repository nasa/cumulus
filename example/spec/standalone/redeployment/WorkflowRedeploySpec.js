'use strict';

const S3 = require('aws-sdk/clients/s3');
const fs = require('fs-extra');
const path = require('path');
const execa = require('execa');

const {
  buildAndStartWorkflow,
  waitForCompletedExecution,
  executionsApi: {
    getExecutionStatus
  }
} = require('@cumulus/integration-tests');

const { randomString } = require('@cumulus/common/test-utils');

const {
  loadConfig,
  protectFile
} = require('../../helpers/testUtils');

const timeout = 30 * 60 * 1000; // Timout for test setup/teardown in milliseconds

const terraformApply = () =>
  execa('terraform', ['apply', '-auto-approve'], {
    cwd: path.join(process.cwd(), 'cumulus-tf'),
    stdout: process.stdout,
    stderr: process.stderr
  });

describe('When a workflow', () => {
  let config;

  beforeAll(async () => {
    config = await loadConfig();
  });

  afterAll(terraformApply);

  describe('is updated and deployed during a workflow execution', () => {
    let redeployFinishedKey;
    let workflowExecutionArn;
    let workflowStatus;

    beforeAll(
      async () => {
        // Make sure that the stack is in the expected state
        await terraformApply();

        redeployFinishedKey = `${config.stackName}/WorkflowRedeploySpec/${randomString()}`;

        // Kick off the workflow, don't wait for completion
        workflowExecutionArn = await buildAndStartWorkflow(
          config.stackName,
          config.bucket,
          'WaitForDeployWorkflow',
          null,
          null,
          null,
          {
            waitForS3ObjectToExistParams: {
              Bucket: config.bucket,
              Key: redeployFinishedKey
            }
          }
        );

        await protectFile(
          path.join(process.cwd(), 'cumulus-tf', 'wait_for_deploy_workflow.tf'),
          async (workflowFilename) => {
            await fs.copy(
              path.join(__dirname, 'wait_for_deploy_without_hello_world_workflow.tf'),
              workflowFilename
            );

            await terraformApply();
          }
        );

        const s3 = new S3();

        // This is the S3 object that the workflow is waiting to exist
        await s3.putObject({
          Bucket: config.bucket,
          Key: redeployFinishedKey,
          Body: 'asdf'
        }).promise();

        workflowStatus = await waitForCompletedExecution(workflowExecutionArn);

        await s3.deleteObject({
          Bucket: config.bucket,
          Key: redeployFinishedKey
        }).promise();
      },
      timeout
    );

    it('the workflow executes successfully', () => {
      expect(workflowStatus).toEqual('SUCCEEDED');
    });

    describe('When querying the workflow via the API', () => {
      let executionStatus;

      beforeAll(async () => {
        const executionStatusResponse = await getExecutionStatus({
          prefix: config.stackName,
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
});

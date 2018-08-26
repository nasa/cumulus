'use strict';

const {
  buildAndStartWorkflow,
  waitForCompletedExecution,
  LambdaStep
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  redeploy
} = require('../helpers/testUtils');

const config = loadConfig();
const fs = require('fs-extra');
const lambdaStep = new LambdaStep();

describe('When a workflow', () => {
  describe('is running and a new version of a workflow lambda is deployed', () => {
    let workflowExecutionArn = null;
    let workflowStatus = null;
    let testVersionOutput = null;

    beforeAll(async () => {
      const lambdaName = 'VersionUpTest';
      fs.copySync('./lambdas/versionUpTest/original.js', './lambdas/versionUpTest/index.js');
      await redeploy(config);
      fs.copySync('./lambdas/versionUpTest/update.js', './lambdas/versionUpTest/index.js');
      workflowExecutionArn = await buildAndStartWorkflow(
        config.stackName,
        config.bucket,
        'TestLambdaVersionWorkflow'
      );
      await redeploy(config);
      workflowStatus = await waitForCompletedExecution(workflowExecutionArn);
      testVersionOutput = await lambdaStep.getStepOutput(
        workflowExecutionArn,
        lambdaName
      );
    });

    it('the workflow executes successfully', () => {
      expect(workflowStatus).toEqual('SUCCEEDED');
    });

    it('uses the original software version', () => {
      expect(testVersionOutput.payload).toEqual({ output: 'Current Version' });
    });
  });
});

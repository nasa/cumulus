'use strict';

const stepFunctions = require('@cumulus/common/step-functions');
const {
  buildAndStartWorkflow,
  LambdaStep
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  redeploy
} = require('../helpers/testUtils');

const { updateConfigObject } = require('../helpers/configUtils');

const config = loadConfig();
const lambdaStep = new LambdaStep();

describe('When a workflow', () => {
  afterAll(async () => {
    // Restore deployment following all following tests
    const updateConfig = { handler: 'index.handler' };
    const lambdaName = 'VersionUpTest';
    const lambdaConfigFileName = './lambdas.yml';
    updateConfigObject(lambdaConfigFileName, lambdaName, updateConfig);
    await redeploy(config);
  });

  describe('is running and a new version of a workflow lambda is deployed', () => {
    let workflowExecutionArn = null;
    let workflowStatus = null;
    let testVersionOutput = null;

    beforeAll(async () => {
      const updateConfig = { handler: 'update.handler' };
      const lambdaName = 'VersionUpTest';
      const lambdaConfigFileName = './lambdas.yml';

      workflowExecutionArn = await buildAndStartWorkflow(
        config.stackName,
        config.bucket,
        'TestLambdaVersionWorkflow'
      );
      updateConfigObject(lambdaConfigFileName, lambdaName, updateConfig);
      await redeploy(config);

      workflowStatus = await stepFunctions.getCompletedExecutionStatus(
        workflowExecutionArn,
        { waitToExist: true }
      );

      testVersionOutput = await lambdaStep.getStepOutput(
        workflowExecutionArn,
        lambdaName
      );
    });

    xit('the workflow executes successfully', () => {
      expect(workflowStatus).toEqual('SUCCEEDED');
    });

    xit('uses the original software version', () => {
      expect(testVersionOutput.payload).toEqual({ output: 'Current Version' });
    });
  });
});

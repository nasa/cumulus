const { buildAndStartWorkflow, waitForCompletedExecution } = require('@cumulus/integration-tests');
const {
  loadConfig,
  redeploy
} = require('../helpers/testUtils');

const awsConfig = loadConfig();

describe('The Hello World workflow', () => {
  let workflowExecutionArn = null;
  let workflowStatus = null;

  beforeAll(async () => {
    workflowExecutionArn = await buildAndStartWorkflow(
      awsConfig.stackName,
      awsConfig.bucket,
      'WaitForDeployWorkflow'
    );

    await redeploy(awsConfig);

    workflowStatus = await waitForCompletedExecution(workflowExecutionArn);
  });

  it('executes successfully', () => {
    expect(workflowStatus).toEqual('SUCCEEDED');
  });
});

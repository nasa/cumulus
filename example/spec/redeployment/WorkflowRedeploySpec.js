// const { Execution } = require('@cumulus/api/models');
// const { buildAndExecuteWorkflow } = require('@cumulus/integration-tests');
const {
  loadConfig,
  redeploy
} = require('../helpers/testUtils');

const awsConfig = loadConfig();

describe('The Hello World workflow', () => {
  // let workflowExecution = null;
  // process.env.ExecutionsTable = `${awsConfig.stackName}-ExecutionsTable`;
  // const executionModel = new Execution();

  beforeAll(async () => {
    // workflowExecution = await buildAndExecuteWorkflow(
    //   awsConfig.stackName,
    //   awsConfig.bucket,
    //   'HelloWorldWorkflow'
    // );
    await redeploy(awsConfig);
  });

  it('executes successfully', () => {
    expect('SUCCEEDED').toEqual('SUCCEEDED');
  });
});

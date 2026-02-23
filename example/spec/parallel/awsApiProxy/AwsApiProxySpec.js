const { loadConfig } = require('../../helpers/testUtils');
const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');

describe('The aws_api_proxy deployed within a Cumulus workflow', () => {

  beforeAll(async () => {
    config = await loadConfig();

    const workflowName = 'GranuleInvalidatorWorkflow';

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      workflowName,
      {},
      config.provider,
      config.payload
    );
  });

  it('executes successfully', () => {
    expect(workflowExecution.status).toEqual('completed');
  });
});
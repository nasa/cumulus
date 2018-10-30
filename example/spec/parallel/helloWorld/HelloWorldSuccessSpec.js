const { Execution } = require('@cumulus/api/models');
const { buildAndExecuteWorkflow, LambdaStep } = require('@cumulus/integration-tests');
const { loadConfig } = require('../../helpers/testUtils');

const awsConfig = loadConfig();
const lambdaStep = new LambdaStep();

describe('The Hello World workflow', () => {
  let workflowExecution = null;
  process.env.ExecutionsTable = `${awsConfig.stackName}-ExecutionsTable`;
  const executionModel = new Execution();

  beforeAll(async () => {
    workflowExecution = await buildAndExecuteWorkflow(
      awsConfig.stackName,
      awsConfig.bucket,
      'HelloWorldWorkflow'
    );
  });

  it('executes successfully', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('the HelloWorld Lambda', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'HelloWorld');
    });

    it('output is Hello World', () => {
      expect(lambdaOutput.payload).toEqual({ hello: 'Hello World' });
    });
  });

  describe('the sf-sns-report task has published a sns message and', () => {
    it('the execution record is added to DynamoDB', async () => {
      const record = await executionModel.get({ arn: workflowExecution.executionArn });
      expect(record.status).toEqual('completed');
    });
  });
});

const { buildAndExecuteWorkflow, LambdaStep } = require('@cumulus/integration-tests');
const { loadConfig } = require('../../helpers/testUtils');

const awsConfig = loadConfig();
const lambdaStep = new LambdaStep();

/**
 * For multiple executions of a step, get the time intervals at which retries
 * were scheduled
 *
 * @param {List<Object>} executions - the executions of the lambda
 * @returns {List<Integer>} - list of seconds between retries
 */
function getRetryIntervals(executions) {
  const retryIntervals = [];

  for (let i = 1; i < executions.length; i += 1) {
    const intervalSeconds = (
      executions[i].scheduleEvent.timestamp - executions[i - 1].completeEvent.timestamp
    ) / 1000;
    retryIntervals.push(Math.round(intervalSeconds));
  }

  return retryIntervals;
}

describe('When a task is configured to retry', () => {
  let workflowExecution = null;
  process.env.ExecutionsTable = `${awsConfig.stackName}-ExecutionsTable`;
  let lambdaExecutions = null;

  beforeAll(async () => {
    workflowExecution = await buildAndExecuteWorkflow(
      awsConfig.stackName,
      awsConfig.bucket,
      'RetryPassWorkflow'
    );

    lambdaExecutions = await lambdaStep.getStepExecutions(workflowExecution.executionArn, 'HelloWorld');
  });

  describe('and it fails', () => {
    it('Cumulus retries it', () => {
      expect(lambdaExecutions.length).toBeGreaterThan(1);
    });
  });

  describe('and it succeeds', () => {
    it('Cumulus continues the workflow', () => {
      expect(workflowExecution.status).toEqual('SUCCEEDED');
    });
  });
});

describe('When a task is not configured to retry', () => {
  let workflowExecution = null;

  beforeAll(async () => {
    workflowExecution = await buildAndExecuteWorkflow(
      awsConfig.stackName,
      awsConfig.bucket,
      'HelloWorldFailWorkflow'
    );
  });

  it('Cumulus fails the workflow', () => {
    expect(workflowExecution.status).toEqual('FAILED');
  });
});

describe('When a task is configured to retry', () => {
  let workflowExecution = null;
  let lambdaExecutions = null;
  let retryIntervals = [];

  beforeAll(async () => {
    workflowExecution = await buildAndExecuteWorkflow(
      awsConfig.stackName,
      awsConfig.bucket,
      'RetryFailWorkflow'
    );

    lambdaExecutions = await lambdaStep.getStepExecutions(workflowExecution.executionArn, 'HelloWorld');
    retryIntervals = getRetryIntervals(lambdaExecutions);
  });

  describe('a specific number of times', () => {
    it('and it fails that number of times, Cumulus stops retrying it and fails the workflow', () => {
      expect(workflowExecution.status).toEqual('FAILED');
      expect(lambdaExecutions.length).toEqual(4);
    });
  });

  describe('with a backoff', () => {
    it('and it fails, Cumulus retries it with the configured backoff time', () => {
      expect(retryIntervals).toEqual([2, 4, 8]);
    });
  });
});

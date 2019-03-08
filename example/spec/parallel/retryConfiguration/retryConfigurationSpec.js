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

describe('When a task is configured', () => {
  let retryPassWorkflowExecution = null;
  let noRetryWorkflowExecution = null;
  let retryFailWorkflowExecution = null;

  let retryPassLambdaExecutions = null;
  let retryFailLambdaExecutions = null;

  process.env.ExecutionsTable = `${awsConfig.prefix}-ExecutionsTable`;

  beforeAll(async () => {
    const retryPassPromise = buildAndExecuteWorkflow(
      awsConfig.stackName,
      awsConfig.bucket,
      'RetryPassWorkflow'
    );

    const noRetryPromise = buildAndExecuteWorkflow(
      awsConfig.stackName,
      awsConfig.bucket,
      'HelloWorldFailWorkflow'
    );

    const retryFailPromise = buildAndExecuteWorkflow(
      awsConfig.stackName,
      awsConfig.bucket,
      'RetryFailWorkflow'
    );

    const executions = await Promise.all([
      retryPassPromise,
      noRetryPromise,
      retryFailPromise
    ]);

    retryPassWorkflowExecution = executions[0];
    noRetryWorkflowExecution = executions[1];
    retryFailWorkflowExecution = executions[2];

    const retryPassLambdaExecutionsPromise = lambdaStep.getStepExecutions(retryPassWorkflowExecution.executionArn, 'HelloWorld');
    const retryFailLambdaExecutionsPromise = lambdaStep.getStepExecutions(retryFailWorkflowExecution.executionArn, 'HelloWorld');

    const lambdaExecutions = await Promise.all([
      retryPassLambdaExecutionsPromise,
      retryFailLambdaExecutionsPromise
    ]);

    retryPassLambdaExecutions = lambdaExecutions[0];
    retryFailLambdaExecutions = lambdaExecutions[1];
  });

  describe('to retry', () => {
    describe('and it fails', () => {
      it('Cumulus retries it', () => {
        expect(retryPassLambdaExecutions.length).toBeGreaterThan(1);
      });
    });

    describe('and it succeeds', () => {
      it('Cumulus continues the workflow', () => {
        expect(retryPassWorkflowExecution.status).toEqual('SUCCEEDED');
      });
    });
  });

  describe('not to retry', () => {
    it('Cumulus fails the workflow', () => {
      expect(noRetryWorkflowExecution.status).toEqual('FAILED');
    });
  });

  describe('a specific number of times', () => {
    it('and it fails that number of times, Cumulus stops retrying it and fails the workflow', () => {
      expect(retryFailWorkflowExecution.status).toEqual('FAILED');
      expect(retryFailLambdaExecutions.length).toEqual(4);
    });
  });

  describe('with a backoff', () => {
    it('and it fails, Cumulus retries it with the configured backoff time', () => {
      const retryIntervals = getRetryIntervals(retryFailLambdaExecutions);
      expect(retryIntervals).toEqual([2, 4, 8]);
    });
  });
});

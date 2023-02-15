const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { deleteExecution } = require('@cumulus/api-client/executions');

const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const { loadConfig } = require('../../helpers/testUtils');

const lambdaStep = new LambdaStep();

let config;

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
    retryIntervals.push(intervalSeconds);
  }

  return retryIntervals;
}

describe('When a task is configured', () => {
  let retryPassWorkflowExecution;
  let noRetryWorkflowExecution;
  let retryFailWorkflowExecution;

  let retryPassLambdaExecutions;
  let retryFailLambdaExecutions;
  beforeAll(async () => {
    config = await loadConfig();


    const retryPassPromise = buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      'RetryPassWorkflow'
    );

    const noRetryPromise = buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      'HelloWorldFailWorkflow'
    );

    const retryFailPromise = buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      'RetryFailWorkflow'
    );

    const executions = await Promise.all([
      retryPassPromise,
      noRetryPromise,
      retryFailPromise,
    ]);

    retryPassWorkflowExecution = executions[0];
    noRetryWorkflowExecution = executions[1];
    retryFailWorkflowExecution = executions[2];

    const retryPassLambdaExecutionsPromise = lambdaStep.getStepExecutions(retryPassWorkflowExecution.executionArn, 'HelloWorld');
    const retryFailLambdaExecutionsPromise = lambdaStep.getStepExecutions(retryFailWorkflowExecution.executionArn, 'HelloWorld');

    const lambdaExecutions = await Promise.all([
      retryPassLambdaExecutionsPromise,
      retryFailLambdaExecutionsPromise,
    ]);

    retryPassLambdaExecutions = lambdaExecutions[0];
    retryFailLambdaExecutions = lambdaExecutions[1];
  });

  afterAll(async () => {
    await Promise.all([
      deleteExecution({ prefix: config.stackName, executionArn: retryPassWorkflowExecution.executionArn }),
      deleteExecution({ prefix: config.stackName, executionArn: noRetryWorkflowExecution.executionArn }),
      deleteExecution({ prefix: config.stackName, executionArn: retryFailWorkflowExecution.executionArn }),
    ]);
  });

  describe('to retry', () => {
    describe('and it fails', () => {
      it('Cumulus retries it', () => {
        expect(retryPassLambdaExecutions.length).toBeGreaterThan(1);
      });
    });

    describe('and it succeeds', () => {
      it('Cumulus continues the workflow', () => {
        expect(retryPassWorkflowExecution.status).toEqual('completed');
      });
    });
  });

  describe('not to retry', () => {
    it('Cumulus fails the workflow', () => {
      expect(noRetryWorkflowExecution.status).toEqual('failed');
    });
  });

  describe('a specific number of times', () => {
    it('and it fails that number of times, Cumulus stops retrying it and fails the workflow', () => {
      expect(retryFailWorkflowExecution.status).toEqual('failed');
      expect(retryFailLambdaExecutions.length).toEqual(4);
    });
  });

  describe('with a backoff', () => {
    it('and it fails, Cumulus retries it with the configured backoff time', () => {
      const retryIntervals = getRetryIntervals(retryFailLambdaExecutions);
      const expectedIntervals = [2, 4, 8];
      expectedIntervals.forEach((expectedInterval, index) => {
        console.log(`expected interval: ${expectedInterval}, Actual: ${retryIntervals[index]}`);
        expect((retryIntervals[index] - expectedInterval)).toBeLessThanOrEqual(1);
        expect((retryIntervals[index] - expectedInterval)).toBeGreaterThanOrEqual(0);
      });
    });
  });
});

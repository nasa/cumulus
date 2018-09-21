/** @module */

'use strict';

const pRetry = require('p-retry');
const pTimeout = require('p-timeout');
const pWaitFor = require('p-wait-for');
const uuidv4 = require('uuid/v4');

const {
  sfn,
  toSfnExecutionName
} = require('./aws');


/**
 * Constructs the input to pass to the step functions to kick off ingest. The execution name
 * that should be used is returned in ingest_meta.execution_name.
 */
exports.constructStepFunctionInput = (resources, provider, collection) => {
  const stateMachine = collection.workflow;
  const meta = JSON.parse(JSON.stringify(collection.meta || {}));
  const startDate = new Date().toISOString();
  const id = uuidv4();
  const executionName = toSfnExecutionName([collection.name, id], '__');
  return {
    workflow_config_template: collection.workflow_config_template,
    resources: resources,
    provider: provider,
    ingest_meta: {
      message_source: 'sfn',
      start_date: startDate,
      state_machine: stateMachine,
      execution_name: executionName,
      id: id
    },
    meta: meta,
    exception: 'None',
    payload: null
  };
};

/**
 * Describe a Step Function Execution
 *
 * The StepFunctions API has been known to throw throttling exceptions.  This
 * function will retry up to 10 times with an exponential backoff.
 *
 * @param {string} executionArn - ARN of the execution
 * @param {Object} [retryOptions] - see the options described [here](https://github.com/tim-kos/node-retry#retrytimeoutsoptions)
 * @returns {Promise<Object>} [AWS StepFunctions.describeExecutions response](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/StepFunctions.html#describeExecution-property)
 */
exports.describeExecution = (executionArn, retryOptions) =>
  pRetry(
    () => sfn().describeExecution({ executionArn }).promise()
      .catch((err) => {
        // If we get a throttling exception, we re-throw the error.  This will
        //   trigger the "retry with exponential backoff" functionality.
        if (err.code === 'ThrottlingException') throw err;

        // If we get an error other than the previous two then something went
        //   wrong.  We abort any other retry attempts and throw the error.
        throw new pRetry.AbortError(err);
      }),
    retryOptions
  );

/**
 * Test if a Step Function Execution exists
 *
 * @param {string} executionArn - a Step Function execution ARN
 * @returns {Promise<boolean>} true or false
 */
exports.executionExists = async (executionArn) => {
  try {
    await exports.describeExecution({ executionArn }).promise();
    return true;
  }
  catch (err) {
    if (err.code === 'ExecutionDoesNotExist') return false;
    throw err;
  }
};

/**
 * Wait for a Step Function execution to exist
 *
 * @param {string} executionArn - a Step Function Execution ARN
 * @param {Object} options - options
 * @param {number} options.interval - number of milliseconds to wait before retrying
 * @param {number} options.timeout - number of milliseconds to wait before rejecting
 * @returns {Promise<undefined>} no return value
 * @throws {TimeoutError}
 */
exports.waitForExecutionToExist = async (executionArn, options = {}) =>
  pWaitFor(() => exports.executionExists(executionArn), options);

/**
 * Wait for a given execution to complete
 *
 * @param {string} executionArn - a Step Function Execution ARN
 * @param {Object} options - options
 * @param {number} options.interval - number of milliseconds to wait before retrying
 * @param {number} options.timeout - number of milliseconds to wait before rejecting
 * @param {boolean} options.waitToExist - if the execution does not yet exist,
 *   should it be waited for
 * @returns {Promise<undefined>} undefined
 * @throws {TimeoutError}
 */
exports.waitForCompletedExecution = async (executionArn, options = {}) => {
  const interval = options.interval || 5 * 1000;
  const timeout = options.timeout || 10 * 60 * 1000;

  return pTimeout(
    async () => {
      if (options.waitToExist) {
        await exports.waitForExecutionToExist(
          executionArn,
          { interval, timeout: Infinity }
        );
      }

      return pWaitFor(
        () => exports.describeExecution(executionArn)
          .then(({ status }) => status !== 'RUNNING'),
        { interval, timeout: Infinity }
      );
    },
    { interval, timeout }
  );
};

/**
 * Wait for a given execution to complete, then return the status
 *
 * @param {string} executionArn - a Step Function Execution ARN
 * @param {Object} options - see {@link module:step-functions.waitForCompletedExecution|waitForCompletedExecution}
 * @returns {Promise<string>} the execution status
 * @throws {TimeoutError}
 */
exports.getCompletedExecutionStatus = async (executionArn, options = {}) => {
  await exports.waitForCompletedExecution(executionArn, options);

  const { status } = await exports.describeExecution(executionArn);

  return status;
};

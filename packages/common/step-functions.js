'use strict';

const pRetry = require('p-retry');
const uuidv4 = require('uuid/v4');

const { sleep } = require('./util');

const {
  isThrottlingException,
  sfn,
  toSfnExecutionName
} = require('./aws');

const log = require('./log');

/**
 * Constructs the input to pass to the step functions to kick off ingest. The execution name
 * that should be used is returned in ingest_meta.execution_name.
 *
 * @param {*} resources
 * @param {*} provider
 * @param {*} collection
 * @returns {Object} a step function input
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

const logSfnThrottlingException = (fn) => {
  log.debug(`ThrottlingException in stepfunctions.${fn}(), will retry`);
};

const retryOnThrottlingException = (err) => {
  if (isThrottlingException(err)) throw err;
  throw new pRetry.AbortError(err);
};

/**
 * Describe a Step Function Execution
 *
 * The StepFunctions API has been known to throw throttling exceptions.  This
 * function will retry up to 10 times with an exponential backoff.
 *
 * @param {string} executionArn - ARN of the execution
 * @param {Object} [retryOptions] - see the options described [here](https://github.com/tim-kos/node-retry#retrytimeoutsoptions)
 * @returns {Promise<Object>} https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/StepFunctions.html#describeExecution-property
 */
exports.describeExecution = (executionArn, retryOptions) => {
  const fullRetryOptions = Object.assign(
    {
      onFailedAttempt: () => logSfnThrottlingException('describeExecution')
    },
    retryOptions
  );

  return pRetry(
    () => sfn().describeExecution({ executionArn }).promise()
      .catch(retryOnThrottlingException),
    fullRetryOptions
  );
};

/**
 * Test if a Step Function Execution exists
 *
 * @param {string} executionArn - a Step Function execution ARN
 * @returns {Promise<boolean>} true or false
 */
exports.executionExists = async (executionArn) => {
  try {
    await exports.describeExecution(executionArn);
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
 * @param {number} options.interval - the number of seconds to wait between checks
 * @param {number} options.timeout - the number of seconds to wait for the execution
 *   to exist
 * @returns {Promise<undefined>} no return value
 */
exports.waitForExecutionToExist = async (executionArn, options = {}) => {
  const {
    interval = 5,
    timeout = 300
  } = options;

  const intervalInMs = interval * 1000;
  const failAfter = Date.now + (timeout * 1000);

  /* eslint-disable no-await-in-loop */
  do {
    if (await exports.executionExists(executionArn)) return;
    await sleep(intervalInMs);
  } while (Date.now() < failAfter);
  /* eslint-enable no-await-in-loop */

  throw new Error(`Timed out waiting for ${executionArn} to exist`);
};

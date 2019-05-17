'use strict';

const uuidv4 = require('uuid/v4');
const get = require('lodash.get');
const has = require('lodash.has');
const {
  aws: {
    dynamodbDocClient,
    sfn
  },
  errors: {
    ResourcesLockedError
  },
  log,
  Semaphore,
  util: {
    isNil
  }
} = require('@cumulus/common');
const { Consumer } = require('@cumulus/ingest/consumer');

/**
 * Starts a new stepfunction with the given payload
 *
 * @param {Object} message - incoming queue message
 * @returns {Promise} - AWS SF Start Execution response
 */
function dispatch(message) {
  const input = Object.assign({}, message.Body);

  input.cumulus_meta.workflow_start_time = Date.now();

  if (!input.cumulus_meta.execution_name) {
    input.cumulus_meta.execution_name = uuidv4();
  }

  return sfn().startExecution({
    stateMachineArn: message.Body.cumulus_meta.state_machine,
    input: JSON.stringify(input),
    name: input.cumulus_meta.execution_name
  }).promise();
}

/**
 * Increment the priority semaphore.
 *
 * @param {string} key - Key for the priority semaphore
 * @param {number} maximum - Maximum number of executions allowed for this semaphore
 * @returns {Promise}
 * @throws {Error}
 */
async function incrementPrioritySemaphore(key, maximum) {
  const semaphore = new Semaphore(
    dynamodbDocClient(),
    process.env.SemaphoresTable
  );

  try {
    await semaphore.up(key, maximum);
  } catch (err) {
    if (err instanceof ResourcesLockedError) {
      log.info(`Unable to start new execution: the maximum number of executions for ${key} are already running.`);
    }
    throw err;
  }
}

/**
 * Attempt to increment the priority semaphore and start a new execution.
 *
 * If `incrementPrioritySemaphore()` is unable to increment the priority semaphore,
 * it throws an error and `dispatch()` is not called.
 *
 * @param {Object} queueMessage - SQS message
 * @returns {Promise} - Promise returned by `dispatch()`
 * @throws {Error}
 */
async function incrementAndDispatch(queueMessage) {
  const message = get(queueMessage, 'Body');
  const cumulusMeta = get(message, 'cumulus_meta', {});

  const priorityKey = cumulusMeta.priorityKey;
  if (isNil(priorityKey)) {
    throw new Error('cumulus_meta.priorityKey not set in message');
  }

  const maxExecutions = get(cumulusMeta, `priorityLevels.${priorityKey}.maxExecutions`);
  if (isNil(maxExecutions)) {
    throw new Error(`Could not determine maximum executions for priority ${priorityKey}`);
  }

  await incrementPrioritySemaphore(priorityKey, maxExecutions);

  return dispatch(message);
}

/**
 * This is an SQS queue consumer.
 *
 * It reads messages from a given SQS queue based on the configuration provided
 * in the event object.
 *
 * The default is to read 1 message from a given queueUrl and quit after 240
 * seconds.
 *
 * @param {Object} event - lambda input message
 * @param {string} event.queueUrl - AWS SQS url
 * @param {string} event.messageLimit - number of messages to read from SQS for
 *   this execution (default 1)
 * @param {string} event.timeLimit - how many seconds the lambda function will
 *   remain active and query the queue (default 240 s)
 * @param {function} dispatchFn - the function to dispatch to process each message
 * @param {number} visibilityTimeout - how many seconds messages received from
 *   the queue will be invisible before they can be read again
 * @returns {Promise} - A promise resolving to how many executions were started
 * @throws {Error}
 */
async function handleEvent(event, dispatchFn, visibilityTimeout) {
  const messageLimit = event.messageLimit || 1;
  const timeLimit = event.timeLimit || 240;

  if (!event.queueUrl) {
    throw new Error('queueUrl is missing');
  }

  const consumer = new Consumer({
    queueUrl: event.queueUrl,
    messageLimit,
    timeLimit,
    visibilityTimeout
  });
  return consumer.consume(dispatchFn);
}

/**
 * Handler for messages from normal SQS queues.
 *
 * @param {Object} event - Lambda input message from SQS
 * @returns {Promise} - A promise resolving to how many executions were started
 * @throws {Error}
 */
async function sqs2sfHandler(event) {
  return handleEvent(event, dispatch);
}

/**
 * Wrapper for handler of priority SQS messages.
 *
 * Using a wrapper function allows injecting optional parameters
 * in testing, such as the visibility timeout when reading SQS
 * messages.
 *
 * @param {Object} event - Lambda input message from SQS
 * @param {number} visibilityTimeout - Optional visibility timeout to use when reading
 *   SQS messages
 * @returns {Promise} - A promise resolving to how many executions were started
 * @throws {Error}
 */
function handleThrottledEvent(event, visibilityTimeout) {
  return handleEvent(event, incrementAndDispatch, visibilityTimeout);
}

/**
 * Handler for messages from priority SQS queues.
 *
 * @param {Object} event - Lambda input message from SQS
 * @returns {Promise} - A promise resolving to how many executions were started
 * @throws {Error}
 */
async function sqs2sfThrottleHandler(event) {
  return handleThrottledEvent(event);
}

module.exports = {
  incrementAndDispatch,
  sqs2sfHandler,
  sqs2sfThrottleHandler,
  handleThrottledEvent
};

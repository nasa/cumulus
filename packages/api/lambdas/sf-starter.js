'use strict';

const uuidv4 = require('uuid/v4');
const get = require('lodash.get');
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

const {
  getQueueName,
  getMaximumExecutions
} = require('../lib/queue');

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
 * Increment the semaphore for executions started from a queue.
 *
 * Throws `ResourcesLockedError` if maximum number of executions are already
 * running.
 *
 * @param {string} queueName - Queue name which is used as the semaphore key
 * @param {number} maximum - Maximum number of executions allowed for this semaphore
 * @returns {Promise}
 * @throws {Error}
 */
async function incrementQueueSemaphore(queueName, maximum) {
  const semaphore = new Semaphore(
    dynamodbDocClient(),
    process.env.SemaphoresTable
  );

  try {
    await semaphore.up(queueName, maximum);
  } catch (err) {
    if (err instanceof ResourcesLockedError) {
      log.info(`Unable to start new execution: the maximum number of executions for ${queueName} are already running.`);
    }
    throw err;
  }
}

/**
 * Attempt to increment the queue semaphore and start a new execution.
 *
 * If `incrementQueueSemaphore()` is unable to increment the semaphore,
 * it throws an error and `dispatch()` is not called.
 *
 * @param {Object} queueMessage - SQS message
 * @returns {Promise} - Promise returned by `dispatch()`
 * @throws {Error}
 */
async function incrementAndDispatch(queueMessage) {
  const workflowMessage = get(queueMessage, 'Body', {});

  const queueName = getQueueName(workflowMessage);
  if (isNil(queueName)) {
    throw new Error('cumulus_meta.queueName not set in message');
  }

  const maxExecutions = getMaximumExecutions(workflowMessage, queueName);
  if (isNil(maxExecutions)) {
    throw new Error(`Could not determine maximum executions for queue ${queueName}`);
  }

  await incrementQueueSemaphore(queueName, maxExecutions);

  return dispatch(queueMessage);
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
  const timeLimit = get(event, 'timeLimit', 240);

  if (!event.queueUrl) {
    throw new Error('queueUrl is missing');
  }

  if (timeLimit <= 0) {
    throw new Error('timeLimit must be greater than 0');
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
  handleEvent,
  handleThrottledEvent
};

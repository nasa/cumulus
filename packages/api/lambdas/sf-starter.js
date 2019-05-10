'use strict';

const uuidv4 = require('uuid/v4');
const get = require('lodash.get');
const has = require('lodash.has');
const { dynamodbDocClient, sfn } = require('@cumulus/common/aws');
const { ResourcesLockedError } = require('@cumulus/common/errors');
const log = require('@cumulus/common/log');
const Semaphore = require('@cumulus/common/Semaphore');
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

async function incrementPrioritySemaphore(key, maximum) {
  const semaphore = new Semaphore(
    dynamodbDocClient(),
    process.env.SemaphoresTable
  );

  try {
    await semaphore.up(key, maximum);
  } catch (err) {
    if (err instanceof ResourcesLockedError) {
      log.info(`The maximum number of executions for ${priorityKey} are already running. Could not start a new execution.`)
    }
    throw err;
  }
}

async function incrementAndDispatch(queueMessage) {
  const message = get(queueMessage, 'Body', {});
  if (!has(message, 'cumulus_meta.priorityKey')) {
    throw new Error(`Could not find priority key for message ${message.cumulus_meta}. Skipping.`);
  }

  const priorityKey = get(message, 'cumulus_meta.priorityKey');
  const priorityLevelInfo = get(message, `cumulus_meta.priorityLevels.${priorityKey}`, {});

  const { maxExecutions } = priorityLevelInfo;
  if (!maxExecutions) {
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
 * @param {string} event.visibilityTimeout - how many seconds messages received from
 *   the queue will be invisible before they can be read again (default undefined)
 * @param {function} dispatchFn - the function to dispatch to process each message
 * @returns {Promise} - A promise resolving to how many executions were started
 * @throws {Error}
 */
async function handler(event, dispatchFn) {
  const messageLimit = event.messageLimit || 1;
  const timeLimit = event.timeLimit || 240;

  if (!event.queueUrl) {
    throw new Error('queueUrl is missing')
  }

  const consumer = new Consumer({
    queueUrl: event.queueUrl,
    messageLimit,
    timeLimit,
    visibilityTimeout: event.visibilityTimeout
  });
  return consumer.consume(dispatchFn);
}

async function sqs2sfHandler(event) {
  return handler(event, dispatch);
}

async function sqs2sfThrottleHandler(event) {
  return handler(event, incrementAndDispatch);
}

module.exports = {
  incrementAndDispatch,
  sqs2sfHandler,
  sqs2sfThrottleHandler
};

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

function incrementPrioritySemaphore(key, maximum) {
  const semaphore = new Semaphore(
    dynamodbDocClient(),
    process.env.SemaphoresTable
  );
  return semaphore.up(key, maximum);
}

async function incrementAndDispatch(queueMessage) {
  const message = get(queueMessage, 'Body', {});
  if (!has(message, 'cumulus_meta.priorityKey')) {
    return dispatch(message);
  }

  const priorityKey = get(message, 'cumulus_meta.priorityKey');
  const priorityLevelInfo = get(message, `cumulus_meta.priorityLevels.${priorityKey}`, {});

  const { maxExecutions } = priorityLevelInfo;
  if (!maxExecutions) {
    throw new Error(`Could not determine maximum executions for priority ${priorityKey}`);
  }

  debugger;
  try {
    await incrementPrioritySemaphore(priorityKey, maxExecutions);
  } catch (err) {
    debugger;
    if (err instanceof ResourcesLockedError) {
      log.info(`The maximum number of executions for ${priorityKey} are already running. Could not start a new execution.`)
    }
    throw err;
  }

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
 * @returns {Promise} - A promise resolving to how many executions were started
 * @throws {Error}
 */
async function handler(event) {
  const messageLimit = event.messageLimit || 1;
  const timeLimit = event.timeLimit || 240;

  if (!event.queueUrl) {
    throw new Error('queueUrl is missing')
  }

  const consumer = new Consumer(event.queueUrl, messageLimit, timeLimit);
  return consumer.consume(incrementAndDispatch);
}

module.exports = {
  incrementAndDispatch,
  handler
};

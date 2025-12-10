'use strict';

const uuidv4 = require('uuid/v4');
const get = require('lodash/get');

const { sfn } = require('@cumulus/aws-client/services');
const sqs = require('@cumulus/aws-client/SQS');
const { ExecutionAlreadyExists } = require('@cumulus/aws-client/StepFunctions');
const Logger = require('@cumulus/logger');
const {
  buildExecutionArn,
} = require('@cumulus/message/Executions');
const {
  getMaximumExecutions,
} = require('@cumulus/message/Queue');
const { Consumer } = require('@cumulus/ingest/consumer');
const { ConsumerRateLimited } = require('@cumulus/ingest/consumerRateLimited');

const {
  decrementQueueSemaphore,
  incrementQueueSemaphore,
} = require('../lib/SemaphoreUtils');

const logger = new Logger({ sender: '@cumulus/api/lambdas/sf-starter' });

/**
 * Starts a new stepfunction with the given payload
 *
 * @param {string} queueUrl - SQS queue URL
 * @param {Object} message - incoming SQS message object
 * @returns {Promise} - AWS SF Start Execution response
 */
async function dispatch(queueUrl, message) {
  const input = sqs.parseSQSMessageBody(message);

  input.cumulus_meta.workflow_start_time = Date.now();

  if (!input.cumulus_meta.execution_name) {
    input.cumulus_meta.execution_name = uuidv4();
  }

  // Set this value to the queue actually read by this Lambda
  input.cumulus_meta.queueUrl = queueUrl;

  const executionArn = buildExecutionArn(
    input.cumulus_meta.state_machine,
    input.cumulus_meta.execution_name
  );
  logger.debug(`Starting execution ARN ${executionArn} from queue ${queueUrl}`);

  return await sfn().startExecution({
    stateMachineArn: input.cumulus_meta.state_machine,
    input: JSON.stringify(input),
    name: input.cumulus_meta.execution_name,
  });
}

/**
 * Attempt to increment the queue semaphore and start a new execution.
 *
 * If `incrementQueueSemaphore()` is unable to increment the semaphore,
 * it throws an error and `dispatch()` is not called.
 *
 * @param {string} queueUrl - SQS queue URL
 * @param {Object} queueMessage - SQS message
 * @returns {Promise} - Promise returned by `dispatch()`
 * @throws {Error}
 */
async function incrementAndDispatch(queueUrl, queueMessage) {
  const workflowMessage = sqs.parseSQSMessageBody(queueMessage);

  const maxExecutions = getMaximumExecutions(workflowMessage, queueUrl);

  await incrementQueueSemaphore(queueUrl, maxExecutions);

  // If dispatch() fails, execution is not started and thus semaphore will
  // never be decremented for the above increment, so we decrement it
  // manually.
  try {
    return await dispatch(queueUrl, queueMessage);
  } catch (error) {
    await decrementQueueSemaphore(queueUrl);
    throw error;
  }
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

  const consumer = new Consumer({
    queueUrl: event.queueUrl,
    messageLimit,
    timeLimit,
    visibilityTimeout,
  });
  return await consumer.consume(dispatchFn);
}

/**
 * This is an SQS queue consumer.
 *
 * It reads messages from a given SQS queue based on the configuration provided
 * in the event object. It is a rate-limited version of the throttled consumer.
 *
 *
 * @param {Object} event - lambda input message
 * @param {string} event.queueUrl - AWS SQS url
 * @param {string} event.messageLimit - number of messages to read from SQS for
 *   this execution (default 1)
 * @param {function} dispatchFn - the function to dispatch to process each message
 * @param {number} visibilityTimeout - how many seconds messages received from
 *   the queue will be invisible before they can be read again
 * @returns {Promise} - A promise resolving to how many executions were started
 * @throws {Error}
 */
async function handleRateLimitedEvent(event, context, dispatchFn, visibilityTimeout) {
  const rateLimitPerSecond = get(event, 'rateLimitPerSecond', 40);

  if (!event.queueUrls) {
    throw new Error('queueUrls is missing');
  }

  const consumer = new ConsumerRateLimited({
    queueUrls: event.queueUrls,
    timeRemainingFunc: context.getRemainingTimeInMillis,
    visibilityTimeout,
    rateLimitPerSecond,
  });
  return await consumer.consume(dispatchFn);
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
function handleThrottledEvent(event, context, visibilityTimeout) {
  return handleEvent(event, context, incrementAndDispatch, visibilityTimeout);
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
function handleThrottledRateLimitedEvent(event, context, visibilityTimeout) {
  return handleRateLimitedEvent(event, context, incrementAndDispatch, visibilityTimeout);
}

async function handleSourceMappingEvent(event) {
  const sqsRecords = event.Records;
  const batchItemFailures = [];
  await Promise.all(sqsRecords.map(async (sqsRecord) => {
    try {
      return await dispatch(sqsRecord.eventSourceARN, sqsRecord);
    } catch (error) {
      // If error is ExecutionAlreadyExists, do not include in batchItemFailures
      if (error instanceof ExecutionAlreadyExists) {
        logger.debug(`Warning: ${error}`);
        return batchItemFailures;
      }
      logger.error(error);
      return batchItemFailures.push({
        itemIdentifier: sqsRecord.messageId,
      });
    }
  }));

  return { batchItemFailures };
}

/**
 * Handler for messages from priority SQS queues.
 *
 * @param {Object} event - Lambda input message from SQS
 * @returns {Promise} - A promise resolving to how many executions were started
 * @throws {Error}
 */
async function sqs2sfThrottleRateLimitedHandler(event, context) {
  return await handleThrottledRateLimitedEvent(event, context);
}

/**
 * Handler for messages from priority SQS queues.
 *
 * @param {Object} event - Lambda input message from SQS
 * @returns {Promise} - A promise resolving to how many executions were started
 * @throws {Error}
 */
async function sqs2sfThrottleHandler(event, context) {
  return await handleThrottledEvent(event, context);
}

/**
 * Handler for messages from normal SQS queues read via Lambda EventSourceMapping.
 *
 * @param {Object} event - SQS input message from Lambda EventSourceMapping
 * @returns {Promise} - A promise resolving to how many executions were started
 * @throws {Error}
 */
async function sqs2sfEventSourceHandler(event) {
  return await handleSourceMappingEvent(event);
}

module.exports = {
  dispatch,
  incrementAndDispatch,
  sqs2sfEventSourceHandler,
  sqs2sfThrottleHandler,
  sqs2sfThrottleRateLimitedHandler,
  handleEvent,
  handleThrottledEvent,
  handleSourceMappingEvent,
};

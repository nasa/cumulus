'use strict';

const get = require('lodash/get');
const { sqs } = require('@cumulus/aws-client/services');
const { sqsQueueExists } = require('@cumulus/aws-client/SQS');
const log = require('@cumulus/common/log');
const { Consumer } = require('@cumulus/ingest/consumer');
const rulesHelpers = require('../lib/rulesHelpers');
const Rule = require('../models/rules');

/**
 * Looks up enabled 'sqs'-type rules, and processes the messages from
 * the SQS queues defined in the rules.
 *
 * @param {Object} event - lambda input message
 * @param {Function} dispatchFn - dispatch function
 * @returns {[Promises]} Array of promises. Each promise is resolved when
 * messages from SQS queue are processed
 */
async function processQueues(event, dispatchFn) {
  const rulesModel = new Rule();
  let rules;

  try {
    rules = await rulesModel.queryRules({
      type: 'sqs',
      state: 'ENABLED',
    });
  } catch (error) {
    log.error(error);
  }

  const messageLimit = event.messageLimit || 1;
  const timeLimit = event.timeLimit || 240;

  const rulesByQueueMap = rules.reduce((map, rule) => {
    const queueUrl = rule.rule.value;
    // eslint-disable-next-line no-param-reassign
    map[queueUrl] = map[queueUrl] || [];
    map[queueUrl].push(rule);
    return map;
  }, {});

  await Promise.all(Object.keys(rulesByQueueMap).map(async (queueUrl) => {
    const rulesForQueue = rulesByQueueMap[queueUrl];

    if (!(await sqsQueueExists(queueUrl))) {
      const ruleIds = rulesForQueue.map((rule) => rule.id);
      log.info(`Could not find queue ${queueUrl}. Unable to process rules ${ruleIds}`);
      return Promise.resolve();
    }

    // Use the max of the visibility timeouts for all the rules
    // bound to this queue.
    const visibilityTimeout = rulesHelpers.getMaxTimeoutForRules(rulesForQueue);

    const consumer = new Consumer({
      queueUrl,
      messageLimit,
      timeLimit,
      visibilityTimeout,
      deleteProcessedMessage: false,
    });
    log.info(`processing queue ${queueUrl}`);

    const messageConsumerFn = dispatchFn.bind({ rulesForQueue });
    return consumer.consume(messageConsumerFn);
  }));
}

/**
 * Process an SQS message
 *
 * @param {string} queueUrl - Queue URL for incoming message
 * @param {Object} message - incoming queue message
 * @returns {Promise} - promise resolved when the message is dispatched
 */
function dispatch(queueUrl, message) {
  const messageReceiveCount = Number.parseInt(message.Attributes.ApproximateReceiveCount, 10);
  const rulesForQueue = this.rulesForQueue;

  const eventObject = JSON.parse(message.Body);
  const eventCollection = rulesHelpers.lookupCollectionInEvent(eventObject);

  const rulesToSchedule = rulesHelpers.filterRulesbyCollection(rulesForQueue, eventCollection);

  return Promise.all(rulesToSchedule.map((rule) => {
    if (get(rule, 'meta.retries', 3) < messageReceiveCount - 1) {
      log.debug(`message ${message.MessageId} from queue ${queueUrl} has been processed ${messageReceiveCount - 1} times, no more retries`);
      // update visibilityTimeout to 5s
      const params = {
        QueueUrl: queueUrl,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: 5,
      };
      return sqs().changeMessageVisibility(params).promise();
    }

    if (messageReceiveCount !== 1) {
      log.debug(`message ${message.MessageId} from queue ${queueUrl} is being processed ${messageReceiveCount} times`);
    }

    const eventSource = {
      type: 'sqs',
      messageId: message.MessageId,
      queueUrl,
      receiptHandle: message.ReceiptHandle,
      receivedCount: messageReceiveCount,
      deleteCompletedMessage: true,
      workflow_name: rule.workflow,
    };
    return rulesHelpers.queueMessageForRule(rule, eventObject, eventSource);
  }));
}

/**
 * Looks up enabled 'sqs'-type rules, and processes the messages from
 * the SQS queues defined in the rules.
 *
 * @param {*} event - lambda event
 * @param {string} event.messageLimit - number of messages to read from SQS for
 *   this execution (default 1)
 * @param {string} event.timeLimit - how many seconds the lambda function will
 *   remain active and query the queue (default 240 s)
 * @returns {Promise<undefined>} Success message or error
 * @throws {Error}
 */
async function handler(event) {
  return processQueues(event, dispatch);
}

module.exports = {
  handler,
};

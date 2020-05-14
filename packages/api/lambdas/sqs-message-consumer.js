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
  const rules = await rulesModel.getRulesByTypeAndState('sqs', 'ENABLED');

  const messageLimit = event.messageLimit || 1;
  const timeLimit = event.timeLimit || 240;

  const rulesByQueueMap = await rules.reduce(async (previousMap, rule) => {
    // if you use async/await in .reduce, then the returned accumulated
    // value is a promise
    const map = await previousMap;
    const queueUrl = rule.rule.value;

    // does this make sense?
    if (!(await sqsQueueExists(queueUrl))) {
      log.info(`Could not find queue ${queueUrl}`);
      return map;
    }

    map[queueUrl] = map[queueUrl] || [];
    // ensure we don't write duplicates to each key?
    map[queueUrl].push(rule);
    return map;
  }, {});

  await Promise.all(Object.keys(rulesByQueueMap).map((queueUrl) => {
    const rulesForQueue = rulesByQueueMap[queueUrl];

    // TODO: Does this make sense?
    // Use the max of the visibility timeouts for all the rules
    // bound to this queue.
    const visibilityTimeout = rulesForQueue.reduce(
      (prevMax, rule) => Math.max(
        prevMax,
        get(rule, 'meta.visibilityTimeout', 0)
      ),
      0
    );

    const consumer = new Consumer({
      queueUrl,
      messageLimit,
      timeLimit,
      visibilityTimeout,
      deleteProcessedMessage: false
    });
    log.info(`processing queue ${queueUrl}`);

    return consumer.consume(dispatchFn.bind({
      queueUrl,
      rulesForQueue
    }));
  }));
}

/**
 * Process an SQS message
 *
 * @param {Object} message - incoming queue message
 * @returns {Promise} - promise resolved when the message is dispatched
 *
 */
function dispatch(message) {
  const messageReceiveCount = parseInt(message.Attributes.ApproximateReceiveCount, 10);
  const queueUrl = this.queueUrl;
  const rulesForQueue = this.rulesForQueue;
  let rulesToSchedule = rulesForQueue;

  const eventObject = JSON.parse(message.Body);
  const eventCollection = rulesHelpers.lookupCollectionInEvent(eventObject);

  rulesToSchedule = rulesForQueue.filter(
    (queueRule) => {
      // Match as much collection info as we found in the message
      const nameMatch = eventCollection.name
        ? queueRule.collection.name === eventCollection.name
        : true;
      const versionMatch = eventCollection.version
        ? queueRule.collection.version === eventCollection.version
        : true;
      return nameMatch && versionMatch;
    }
  );

  return Promise.all(rulesToSchedule.map((rule) => {
    if (get(rule, 'meta.retries', 3) < messageReceiveCount - 1) {
      log.debug(`message ${message.MessageId} from queue ${queueUrl} has been processed ${messageReceiveCount - 1} times, no more retries`);
      // update visibilityTimeout to 5s
      const params = {
        QueueUrl: queueUrl,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: 5
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
      workflow_name: rule.workflow
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
  handler
};

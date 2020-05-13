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

  const queueMap = await rules.reduce(async (map, rule) => {
    // if you use async/await in .reduce, then the returned accumulated
    // value is a promise
    const test = await map;
    const queueUrl = rule.rule.value;

    // does this make sense?
    if (!(await sqsQueueExists(queueUrl))) {
      log.info(`Could not find queue ${queueUrl}`);
      return test;
    }

    test[queueUrl] = test[queueUrl] || [];
    // ensure we don't write duplicates to each key?
    test[queueUrl].push(rule);
    return test;
  }, {});

  await Promise.all(Object.keys(queueMap).map((queueUrl) => {
    const consumer = new Consumer({
      queueUrl,
      messageLimit,
      timeLimit,
      // TODO: does this matter now since we're only consuming each
      // queue message once per invocation, not once per rule?
      // visibilityTimeout: rule.meta.visibilityTimeout,
      deleteProcessedMessage: false
    });
    log.info(`processing queue ${queueUrl}`);
    const rulesForQueue = queueMap[queueUrl];
    return consumer.consume(dispatchFn.bind({
      queueUrl,
      rulesForQueue
    }));
  }));

  // await Promise.all(rules.map(async (rule) => {
  //   const queueUrl = rule.rule.value;

  //   if (!(await sqsQueueExists(queueUrl))) return Promise.resolve();

  //   const consumer = new Consumer({
  //     queueUrl: queueUrl,
  //     messageLimit,
  //     timeLimit,
  //     visibilityTimeout: rule.meta.visibilityTimeout,
  //     deleteProcessedMessage: false
  //   });
  //   log.info(`processQueues for rule ${rule.name} and queue ${queueUrl}`);
  //   return consumer.consume(dispatchFn.bind({ rule: rule }));
  // }));
}

function dispatch2(message) {
  const messageReceiveCount = parseInt(message.Attributes.ApproximateReceiveCount, 10);
  const queueUrl = this.queueUrl;
  const rulesForQueue = this.rulesForQueue;
  let rulesToSchedule = rulesForQueue;

  const eventObject = JSON.parse(message.Body);
  const eventCollection = rulesHelpers.lookupCollectionInEvent(eventObject);

  // if (eventCollection.name && eventCollection.version) {
  rulesToSchedule = rulesForQueue.filter(
    (queueRule) => {
      let nameMatch = true;
      let versionMatch = true;
      // Match as much collection info as we found in the message
      if (eventCollection.name) {
        nameMatch = queueRule.collection.name === eventCollection.name;
      }
      if (eventCollection.version) {
        versionMatch = queueRule.collection.version === eventCollection.version;
      }
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
 * Process an SQS message
 *
 * @param {Object} message - incoming queue message
 * @returns {Promise} - promise resolved when the message is dispatched
 *
 */
function dispatch(message) {
  const queueUrl = this.rule.rule.value;
  const messageReceiveCount = parseInt(message.Attributes.ApproximateReceiveCount, 10);

  if (get(this.rule, 'meta.retries', 3) < messageReceiveCount - 1) {
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

  const eventObject = JSON.parse(message.Body);
  const eventSource = {
    type: 'sqs',
    messageId: message.MessageId,
    queueUrl,
    receiptHandle: message.ReceiptHandle,
    receivedCount: messageReceiveCount,
    deleteCompletedMessage: true,
    workflow_name: this.rule.workflow
  };
  return rulesHelpers.queueMessageForRule(this.rule, eventObject, eventSource);
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
  return processQueues(event, dispatch2);
}

module.exports = {
  handler
};

'use strict';

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
  const model = new Rule();
  const rules = await model.getRulesByTypeAndState('sqs', 'ENABLED');

  const messageLimit = event.messageLimit || 1;
  const timeLimit = event.timeLimit || 240;

  await Promise.all(rules.map((rule) => {
    const queueUrl = rule.rule.value;
    const consumer = new Consumer({
      queueUrl: queueUrl,
      messageLimit,
      timeLimit
    });
    log.info(`processQueues for rule ${rule.name} and queue ${queueUrl}`);
    return consumer.consume(dispatchFn.bind({ rule: rule }));
  }));
}

/**
 * process an SQS message
 *
 * @param {Object} message - incoming queue message
 * @returns {Promise} - promise resolved when the message is dispatched
 *
 */
function dispatch(message) {
  const input = Object.assign({}, message.Body);
  return rulesHelpers.queueMessageForRule(this.rule, input);
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
 * @param {*} context - lambda context
 * @param {*} cb - callback function to explicitly return information back to the caller.
 * @returns {(error|string)} Success message or error
 */
function handler(event, context, cb) {
  return processQueues(event, dispatch)
    .catch((err) => {
      cb(err);
    });
}

module.exports = {
  handler
};

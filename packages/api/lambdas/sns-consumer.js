/* eslint-disable require-yield */

'use strict';

const Ajv = require('ajv');
const {
  aws: { sns },
  log
} = require('@cumulus/common');
const Rule = require('../models/rules');
const { queueMessageForRule } = require('../lib/rulesHelpers');

/**
 * `getSnsRules` scans and returns DynamoDB rules table for enabled,
 * 'sns'-type rules associated with the * collection declared in the event
 *
 * @param {Object} event - lambda event
 * @returns {Array} List of zero or more rules found from table scan
 */
async function getSnsRules(topicArn) {
  const model = new Rule();
  const snsRules = await model.scan({
    names: {
      '#st': 'state',
      '#rl': 'rule',
      '#tp': 'type',
      '#vl': 'value'
    },
    filter: '#st = :enabledState AND #rl.#tp = :ruleType AND #rl.#vl = :ruleValue',
    values: {
      ':enabledState': 'ENABLED',
      ':ruleType': 'sns',
      ':ruleValue': topicArn
    }
  });

  return snsRules.Items;
}

/**
 * Process data sent to a kinesis stream. Validate the data and
 * queue a workflow message for each rule.
 *
 * @param {*} Notification - from sns
 * @returns {[Promises]} Array of promises. Each promise is resolved when a
 * message is queued for all associated sns rules.
 */
function processNotification(notification) {
  const parsed = JSON.parse(notification.Sns.Message);
  const topicArn = notification.Sns.TopicArn;
  const data = parsed.Records[0];

  return getSnsRules(topicArn)
    .then((snsRules) => (
      Promise.all(snsRules.map((snsRule) => queueMessageForRule(snsRule, data)))
    ))
    .catch((err) => {
      log.error('Caught error in processNotification:');
      log.error(err);
      throw err;
    });
}

/**
 * `handler` Looks up enabled 'kinesis'-type rules associated with the collection
 * in the event argument. It enqueues a message for each kinesis-type rule to trigger
 * the associated workflow.
 *
 * @param {*} event - lambda event
 * @param {*} context - lambda context
 * @param {*} cb - callback function to explicitly return information back to the caller.
 * @returns {(error|string)} Success message or error
 */
function handler(event, context, cb) {
  const notifications = event.Records;

  return Promise.all(notifications.map(processNotification))
    .then((results) => cb(null, results.filter((r) => r !== undefined)))
    .catch((err) => {
      cb(err);
    });
}

module.exports = {
  getSnsRules,
  handler
};

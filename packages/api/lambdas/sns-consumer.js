/* eslint-disable require-yield */

'use strict';

const Ajv = require('ajv');
const {
  aws: { sns },
  log
} = require('@cumulus/common');
const Rule = require('../models/rules');
const sfSchedule = require('./sf-scheduler');

/**
 * `getSnsRules` scans and returns DynamoDB rules table for enabled,
 * 'sns'-type rules associated with the * collection declared in the event
 *
 * @param {Object} event - lambda event
 * @returns {Array} List of zero or more rules found from table scan
 */
async function getSnsRules() {
  const model = new Rule();
  const snsRules = await model.scan({
    names: {
      '#nm': 'name',
      '#st': 'state',
      '#rl': 'rule',
      '#tp': 'type'
    },
    filter: '#st = :enabledState AND #rl.#tp = :ruleType',
    values: {
      ':enabledState': 'ENABLED',
      ':ruleType': 'sns'
    }
  });

  return snsRules.Items;
}

/**
 * Queue a workflow message for the kinesis rule with the message passed
 * to kinesis as the payload
 *
 * @param {Object} snsRule - kinesis rule to queue the message for
 * @param {Object} eventObject - message passed to kinesis
 * @returns {Promise} promise resolved when the message is queued
 */
async function queueMessageForRule(snsRule, eventObject) {
  const item = {
    workflow: snsRule.workflow,
    provider: snsRule.provider,
    collection: snsRule.collection,
    payload: eventObject
  };

  const payload = await Rule.buildPayload(item);

  return new Promise((resolve, reject) => sfSchedule(payload, {}, (err, result) => {
    if (err) reject(err);
    resolve(result);
  }));
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
  const data = parsed.Records[0];

  return getSnsRules()
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

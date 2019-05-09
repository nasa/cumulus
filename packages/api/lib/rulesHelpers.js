const { schedule } = require('../lambdas/sf-scheduler');
const Rule = require('../models/rules');

/**
 * Queue a workflow message for the kinesis rule with the message passed
 * to kinesis as the payload
 *
 * @param {Object} rule - rule to queue the message for
 * @param {Object} eventObject - message passed to kinesis
 * @returns {Promise} promise resolved when the message is queued
 */
async function queueMessageForRule(rule, eventObject) {
  const item = {
    workflow: rule.workflow,
    provider: rule.provider,
    collection: rule.collection,
    meta: rule.meta,
    payload: eventObject
  };

  const payload = await Rule.buildPayload(item);

  return new Promise((resolve, reject) => schedule(payload, {}, (err, result) => {
    if (err) reject(err);
    resolve(result);
  }));
}

module.exports = {
  queueMessageForRule
};

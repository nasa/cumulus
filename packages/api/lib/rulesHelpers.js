'use strict';

const isObject = require('lodash.isobject');

const { schedule } = require('../lambdas/sf-scheduler');
const Rule = require('../models/rules');

function lookupCollectionInEvent(eventObject) {
  const { name, version, dataType } = isObject(eventObject.collection)
    ? eventObject.collection
    : eventObject;
  let collectionObject = null;
  if (name && version) {
    collectionObject = { name, version };
    if (dataType) collectionObject.dataType = dataType;
  }
  return collectionObject;
}

/**
 * Queue a workflow message for the kinesis/sqs rule with the message passed
 * to stream/queue as the payload
 *
 * @param {Object} rule - rule to queue the message for
 * @param {Object} eventObject - message passed to stream/queue
 * @param {Object} eventSource - source information of the event
 * @returns {Promise} promise resolved when the message is queued
 */
async function queueMessageForRule(rule, eventObject, eventSource) {
  const item = {
    workflow: rule.workflow,
    provider: eventObject.provider || rule.provider,
    collection: lookupCollectionInEvent(eventObject) || rule.collection,
    meta: eventSource ? { ...rule.meta, eventSource } : rule.meta,
    payload: eventObject
  };

  const payload = await Rule.buildPayload(item);

  return schedule(payload);
}

module.exports = {
  queueMessageForRule
};

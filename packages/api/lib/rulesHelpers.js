'use strict';

const get = require('lodash/get');

const { listRules } = require('@cumulus/api-client/rules');
const { removeNilProperties } = require('@cumulus/common/util');
const { handleScheduleEvent } = require('../lambdas/sf-scheduler');
const Rule = require('../models/rules');

/**
 * fetch all rules in the Cumulus API
 *
 * @param {Object} params - function params
 * @param {number} [params.pageNumber] - current page of API results
 * @param {Array<Object>} [params.rules] - partial rules Array
 * @param {Object} [params.queryParams] - API query params, empty query returns all rules
 * @returns {Array<Object>} all matching rules
 */
async function fetchRules({ pageNumber = 1, rules = [], queryParams = {} }) {
  const query = { ...queryParams, page: pageNumber };
  const apiResponse = await listRules({
    prefix: process.env.stackName,
    query,
  });
  const responseBody = JSON.parse(apiResponse.body);
  if (responseBody.results.length > 0) {
    return fetchRules({
      pageNumber: (pageNumber + 1),
      rules: rules.concat(responseBody.results),
      queryParams,
    });
  }
  return rules;
}

async function fetchAllRules() {
  return await fetchRules({});
}

async function fetchEnabledRules() {
  return await fetchRules({ queryParams: { state: 'ENABLED' } });
}

const collectionRuleMatcher = (rule, collection) => {
  // Match as much collection info as we found in the message
  const nameMatch = collection.name
    ? get(rule, 'collection.name') === collection.name
    : true;
  const versionMatch = collection.version
    ? get(rule, 'collection.version') === collection.version
    : true;
  return nameMatch && versionMatch;
};

const filterRulesbyCollection = (rules, collection = {}) => rules.filter(
  (rule) => collectionRuleMatcher(rule, collection)
);

const filterRulesByRuleParams = (rules, ruleParams) => rules.filter(
  (rule) => {
    const typeMatch = ruleParams.type ? get(ruleParams, 'type') === rule.rule.type : true;
    const collectionMatch = collectionRuleMatcher(rule, ruleParams);
    const sourceArnMatch = ruleParams.sourceArn
      ? get(ruleParams, 'sourceArn') === rule.rule.value
      : true;
    return typeMatch && collectionMatch && sourceArnMatch;
  }
);

const getMaxTimeoutForRules = (rules) => rules.reduce(
  (prevMax, rule) => {
    const ruleTimeout = get(rule, 'meta.visibilityTimeout');
    if (!ruleTimeout) return prevMax;
    return Math.max(
      prevMax || 0,
      ruleTimeout
    );
  },
  undefined
);

function lookupCollectionInEvent(eventObject) {
  // standard case (collection object), or CNM case
  return removeNilProperties({
    name: get(eventObject, 'collection.name', get(eventObject, 'collection')),
    version: get(eventObject, 'collection.version', get(eventObject, 'product.dataVersion')),
    dataType: get(eventObject, 'collection.dataType'),
  });
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
  const collectionInNotification = lookupCollectionInEvent(eventObject);
  const collection = (collectionInNotification.name && collectionInNotification.version)
    ? collectionInNotification
    : rule.collection;
  const item = {
    ...rule,
    collection,
    meta: eventSource ? { ...rule.meta, eventSource } : rule.meta,
    payload: eventObject,
  };

  const payload = await Rule.buildPayload(item);
  return handleScheduleEvent(payload);
}

module.exports = {
  fetchAllRules,
  fetchEnabledRules,
  fetchRules,
  filterRulesbyCollection,
  filterRulesByRuleParams,
  getMaxTimeoutForRules,
  lookupCollectionInEvent,
  queueMessageForRule,
};

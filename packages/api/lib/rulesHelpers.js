'use strict';

const get = require('lodash/get');

const awsServices = require('@cumulus/aws-client/services');
const CloudwatchEvents = require('@cumulus/aws-client/CloudwatchEvents');
const Logger = require('@cumulus/logger');
const {
  getKnexClient,
  RulePgModel,
} = require('@cumulus/db');

const { listRules } = require('@cumulus/api-client/rules');
const { removeNilProperties } = require('@cumulus/common/util');
const { handleScheduleEvent } = require('../lambdas/sf-scheduler');
const { isResourceNotFoundException, ResourceNotFoundError } = require('./errors');
const Rule = require('../models/rules');

const log = new Logger({ sender: '@cumulus/api/rulesHelpers' });
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

/**
* Check if a rule's event source mapping is shared with other rules
*
* @param {Object} item      - the rule item
* @param {Object} eventType - the rule's event type
* @returns {Promise<boolean>} return true if other rules share the same event source mapping
*/
async function isEventSourceMappingShared(item, eventType) {
  const knex = await getKnexClient();
  const rulePgModel = new RulePgModel();
  // Query for count of any other rule that has the same type and arn
  const params = {
    type: item.type,
    ...eventType,
  };
  const [result] = await rulePgModel.count(knex, [[params]]);

  return (result.count > 1);
}

/**
 * Deletes an event source from an event lambda function
 *
 * @param {Object} item      - the rule item
 * @param {string} eventType - kinesisSourceEvent type
 * @param {string} id        - event source id
 * @returns {Promise} the response from event source delete
 */
async function deleteKinesisEventSource(item, eventType, id) {
  if (await isEventSourceMappingShared(item, id)) {
    return undefined;
  }
  const params = {
    UUID: id[eventType],
  };
  return awsServices.lambda().deleteEventSourceMapping(params).promise();
}

/**
 * Delete event source mappings for all mappings in the kinesisSourceEvents
 * @param {Object} item - the rule item
 * @returns {Promise<Array>} array of responses from the event source deletion
 */
async function deleteKinesisEventSources(item) {
  const kinesisSourceEvents = [
    {
      name: process.env.messageConsumer,
      eventType: 'arn',
      type: {
        arn: item.arn,
      },
    },
    {
      name: process.env.KinesisInboundEventLogger,
      eventType: 'log_event_arn',
      type: {
        log_event_arn: item.log_event_arn,
      },
    },
  ];
  const deleteEventPromises = kinesisSourceEvents.map(
    async (lambda) => {
      try {
        await deleteKinesisEventSource(item, lambda.eventType, lambda.type);
      } catch (error) {
        log.error(`Error deleting eventSourceMapping for ${item.name}: ${error}`);
        if (error.code !== 'ResourceNotFoundException') throw error;
      }
    }
  );
  return await Promise.all(deleteEventPromises);
}

/**
 * Delete a rule's SNS trigger
 * @param {Object} item - the rule item
 * @returns {Promise} the response from SNS unsubscribe
 */
async function deleteSnsTrigger(item) {
  // If event source mapping is shared by other rules, don't delete it
  if (await isEventSourceMappingShared(item, { arn: item.rule.arn })) {
    log.info(`Event source mapping ${item} with type 'arn' is shared by multiple rules, so it will not be deleted.`);
    return Promise.resolve();
  }
  // delete permission statement
  const permissionParams = {
    FunctionName: process.env.messageConsumer,
    StatementId: `${item.name}Permission`,
  };
  try {
    await awsServices.lambda().removePermission(permissionParams).promise();
  } catch (error) {
    if (isResourceNotFoundException(error)) {
      throw new ResourceNotFoundError(error);
    }
    throw error;
  }
  // delete sns subscription
  const subscriptionParams = {
    SubscriptionArn: item.rule.arn,
  };
  return awsServices.sns().unsubscribe(subscriptionParams).promise();
}

/**
 * Delete rule resources by rule type
 * @param {Object} item - Item
 */
async function deleteRuleResources(item) {
  const type = item.type;
  switch (type) {
  case 'scheduled': {
    const targetId = 'lambdaTarget';
    const name = `${process.env.stackName}-custom-${item.name}`;
    await CloudwatchEvents.deleteTarget(targetId, name);
    await CloudwatchEvents.deleteEvent(name);
    break;
  }
  case 'kinesis': {
    await deleteKinesisEventSources(item);
    break;
  }
  case 'sns': {
    if (item.state === 'ENABLED') {
      await deleteSnsTrigger(item);
    }
    break;
  }
  case 'sqs':
  default:
    break;
  }
}

module.exports = {
  deleteKinesisEventSource,
  deleteKinesisEventSources,
  deleteRuleResources,
  fetchAllRules,
  fetchEnabledRules,
  fetchRules,
  filterRulesbyCollection,
  filterRulesByRuleParams,
  getMaxTimeoutForRules,
  isEventSourceMappingShared,
  lookupCollectionInEvent,
  queueMessageForRule,
};

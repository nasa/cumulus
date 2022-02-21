'use strict';

const get = require('lodash/get');
const cloneDeep = require('lodash/cloneDeep');

const { listRules } = require('@cumulus/api-client/rules');
const { removeNilProperties } = require('@cumulus/common/util');
const { ValidationError } = require('@cumulus/errors');
const { invoke } = require('@cumulus/aws-client/Lambda');
const { sqsQueueExists } = require('@cumulus/aws-client/SQS');
const awsServices = require('@cumulus/aws-client/services');
const CloudwatchEvents = require('@cumulus/aws-client/CloudwatchEvents');

const Logger = require('@cumulus/logger');

const { handleScheduleEvent } = require('../lambdas/sf-scheduler');
const Rule = require('../models/rules');
const log = new Logger({ sender: '@cumulus/rulesHelpers' });

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

async function addRule(item, payload) {
  const name = `${process.env.stackName}-custom-${item.name}`;
  const state = item.enabled ? 'ENABLED' : 'DISABLED';
  const r = await CloudwatchEvents.putEvent(
    name,
    item.value,
    state,
    'Rule created by cumulus-api'
  );
  const targetId = 'lambdaTarget';

  await CloudwatchEvents.putTarget(
    name,
    targetId,
    process.env.invokeArn,
    JSON.stringify(payload)
  );
  return r.RuleArn;
}

/**
   * add an event source to a target lambda function
   *
   * @param {Object} item - the rule item
   * @param {string} lambda - the name of the target lambda
   * @returns {Promise} a promise
   * @returns {Promise} updated rule item
   */
async function addKinesisEventSource(item, lambda) {
  // use the existing event source mapping if it already exists and is enabled
  const listParams = {
    FunctionName: lambda.name,
    EventSourceArn: item.value,
  };
  const listData = await awsServices.lambda().listEventSourceMappings(listParams).promise();
  if (listData.EventSourceMappings && listData.EventSourceMappings.length > 0) {
    const currentMapping = listData.EventSourceMappings[0];

    // This is for backwards compatibility. Mappings should no longer be disabled.
    if (currentMapping.State === 'Enabled') {
      return currentMapping;
    }
    return awsServices.lambda().updateEventSourceMapping({
      UUID: currentMapping.UUID,
      Enabled: true,
    }).promise();
  }

  // create event source mapping
  const params = {
    EventSourceArn: item.value,
    FunctionName: lambda.name,
    StartingPosition: 'TRIM_HORIZON',
    Enabled: true,
  };
  return awsServices.lambda().createEventSourceMapping(params).promise();
}

/**
 * Add  event sources for all mappings in the kinesisSourceEvents
 * @param {Object} rule - the rule item
 * @returns {Object} return updated rule item containing new arn/logEventArn
 */
async function addKinesisEventSources(rule) {
  const kinesisSourceEvents = [
    {
      name: process.env.messageConsumer,
    },
    {
      name: process.env.KinesisInboundEventLogger,
    },
  ];

  const sourceEventPromises = kinesisSourceEvents.map(
    (lambda) => addKinesisEventSource(rule, lambda).catch(
      (error) => {
        log.error(`Error adding eventSourceMapping for ${rule.name}: ${error}`);
        if (error.code !== 'ResourceNotFoundException') throw error;
      }
    )
  );
  const eventAdd = await Promise.all(sourceEventPromises);
  const arn = eventAdd[0].UUID;
  const logEventArn = eventAdd[1].UUID;
  return { arn, logEventArn };
}

/**
 * Update the event source mappings for Kinesis type rules.
 *
 * Avoids object mutation by cloning the original rule item.
 *
 * @param {Object} ruleItem - A rule item
 * @param {Object} ruleArns
 * @param {string} ruleArns.arn
 *   UUID for event source mapping from Kinesis stream for messageConsumer Lambda
 * @param {string} ruleArns.logEventArn
 *   UUID for event source mapping from Kinesis stream to KinesisInboundEventLogger Lambda
 * @returns {Object} - Updated rule item
 */
function updateKinesisRuleArns(ruleItem, ruleArns) {
  const updatedRuleItem = cloneDeep(ruleItem);
  updatedRuleItem.arn = ruleArns.arn;
  updatedRuleItem.log_event_arn = ruleArns.logEventArn;
  return updatedRuleItem;
}

async function addSnsTrigger(item) {
  // check for existing subscription
  let token;
  let subExists = false;
  let subscriptionArn;
  /* eslint-disable no-await-in-loop */
  do {
    const subsResponse = await awsServices.sns().listSubscriptionsByTopic({
      TopicArn: item.value,
      NextToken: token,
    }).promise();
    token = subsResponse.NextToken;
    if (subsResponse.Subscriptions) {
      /* eslint-disable no-loop-func */
      subsResponse.Subscriptions.forEach((sub) => {
        if (sub.Endpoint === process.env.messageConsumer) {
          subExists = true;
          subscriptionArn = sub.SubscriptionArn;
        }
      });
    }
    /* eslint-enable no-loop-func */
    if (subExists) break;
  }
  while (token);
  /* eslint-enable no-await-in-loop */
  if (!subExists) {
    // create sns subscription
    const subscriptionParams = {
      TopicArn: item.value,
      Protocol: 'lambda',
      Endpoint: process.env.messageConsumer,
      ReturnSubscriptionArn: true,
    };
    const r = await awsServices.sns().subscribe(subscriptionParams).promise();
    subscriptionArn = r.SubscriptionArn;
  }
  // create permission to invoke lambda
  const permissionParams = {
    Action: 'lambda:InvokeFunction',
    FunctionName: process.env.messageConsumer,
    Principal: 'sns.amazonaws.com',
    SourceArn: item.value,
    StatementId: `${item.name}Permission`,
  };
  await awsServices.lambda().addPermission(permissionParams).promise();
  return subscriptionArn;
}

/**
 * Update the event source mapping for SNS type rules.
 *
 * Avoids object mutation by cloning the original rule item.
 *
 * @param {Object} ruleItem - A rule item
 * @param {string} snsSubscriptionArn
 *   UUID for event source mapping from SNS topic to messageConsumer Lambda
 * @returns {Object} - Updated rule item
 */
function updateSnsRuleArn(ruleItem, snsSubscriptionArn) {
  const updatedRuleItem = cloneDeep(ruleItem);
  if (!snsSubscriptionArn) {
    delete updatedRuleItem.arn;
  } else {
    updatedRuleItem.arn = snsSubscriptionArn;
  }
  return updatedRuleItem;
}

/**
 * validate and update sqs rule with queue property
 *
 * @param {Object} rule the sqs rule
 * @returns {Object} the updated sqs rule
 */
async function validateAndUpdateSqsRule(rule) {
  const ruleToUpdate = rule;
  const queueUrl = rule.value;
  if (!(await sqsQueueExists(queueUrl))) {
    throw new Error(`SQS queue ${queueUrl} does not exist or your account does not have permissions to access it`);
  }

  const qAttrParams = {
    QueueUrl: queueUrl,
    AttributeNames: ['All'],
  };
  const attributes = await awsServices.sqs().getQueueAttributes(qAttrParams).promise();
  if (!attributes.Attributes.RedrivePolicy) {
    throw new Error(`SQS queue ${queueUrl} does not have a dead-letter queue configured`);
  }

  // update rule meta
  if (!rule.meta.visibilityTimeout) {
    ruleToUpdate.meta.visibilityTimeout = Number.parseInt(
      attributes.Attributes.VisibilityTimeout,
      10
    );
  }
  if (!rule.meta.retries) {
    ruleToUpdate.meta.retries = 3;
  }
  return ruleToUpdate;
}

/*
 * Checks if record is valid
 * @param {Object} rule
 * @returns {void} returns if record is valid, throws error otherwise
 */
function recordIsValid(rule) {
  const error = new Error('The record has validation errors');
  error.name = 'SchemaValidationError';
  if (!rule.name) {
    error.detail = 'Rule name is undefined.';
    throw error;
  }
  if (!rule.workflow) {
    error.detail = 'Rule workflow is undefined.';
    throw error;
  }
  if (!rule.type) {
    error.detail = 'Rule type is undefined.';
    throw error;
  }
}

/*
 * Creates rule trigger for rule
 * @param {Object} rule
 * @returns {Object} returns new rule object
 */
async function createRuleTrigger(ruleItem) {
  let newRuleItem = cloneDeep(ruleItem);
  // the default value for enabled is true
  if (ruleItem.enabled === undefined) {
    newRuleItem.enabled = true;
  }

  // make sure the name only has word characters
  const re = /\W/;
  if (re.test(ruleItem.name)) {
    throw new ValidationError('Rule name may only contain letters, numbers, and underscores.');
  }

  // Validate rule before kicking off workflows or adding event source mappings
  recordIsValid(newRuleItem);

  const payload = await Rule.buildPayload(newRuleItem);
  switch (newRuleItem.type) {
  case 'onetime': {
    await invoke(process.env.invoke, payload);
    break;
  }
  case 'scheduled': {
    await addRule(newRuleItem, payload);
    break;
  }
  case 'kinesis': {
    const ruleArns = await addKinesisEventSources(newRuleItem);
    newRuleItem = updateKinesisRuleArns(newRuleItem, ruleArns);
    break;
  }
  case 'sns': {
    if (newRuleItem.enabled) {
      const snsSubscriptionArn = await addSnsTrigger(newRuleItem);
      newRuleItem = updateSnsRuleArn(newRuleItem, snsSubscriptionArn);
    }
    break;
  }
  case 'sqs':
    newRuleItem = await validateAndUpdateSqsRule(newRuleItem);
    break;
  default:
    throw new ValidationError(`Rule type \'${newRuleItem.type}\' not supported.`);
  }
  return newRuleItem;
}

module.exports = {
  createRuleTrigger,
  fetchAllRules,
  fetchEnabledRules,
  fetchRules,
  filterRulesbyCollection,
  filterRulesByRuleParams,
  getMaxTimeoutForRules,
  lookupCollectionInEvent,
  queueMessageForRule,
};

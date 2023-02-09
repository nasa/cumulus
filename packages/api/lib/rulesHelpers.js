'use strict';

const get = require('lodash/get');
const set = require('lodash/set');
const cloneDeep = require('lodash/cloneDeep');
const merge = require('lodash/merge');

const awsServices = require('@cumulus/aws-client/services');
const CloudwatchEvents = require('@cumulus/aws-client/CloudwatchEvents');
const Logger = require('@cumulus/logger');
const s3Utils = require('@cumulus/aws-client/S3');
const workflows = require('@cumulus/common/workflows');
const { sqsQueueExists } = require('@cumulus/aws-client/SQS');
const { invoke } = require('@cumulus/aws-client/Lambda');
const { RulePgModel } = require('@cumulus/db');
const { ValidationError } = require('@cumulus/errors');

const { listRules } = require('@cumulus/api-client/rules');
const { removeNilProperties } = require('@cumulus/common/util');

const { handleScheduleEvent } = require('../lambdas/sf-scheduler');
const { isResourceNotFoundException, ResourceNotFoundError } = require('./errors');

const log = new Logger({ sender: '@cumulus/rulesHelpers' });

/**
 * @typedef {import('@cumulus/types/api/rules').RuleRecord} RuleRecord
 * @typedef {import('knex').Knex} Knex
 */

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
 * Build payload from rule for lambda invocation
 *
 * @param {RuleRecord} rule           - API rule
 * @param {Object} [cumulusMeta]      - Optional cumulus_meta object
 *
 * @returns {Object} lambda invocation payload
 */
async function buildPayload(rule, cumulusMeta) {
  // makes sure the workflow exists
  const bucket = process.env.system_bucket;
  const stack = process.env.stackName;
  const workflowFileKey = workflows.getWorkflowFileKey(stack, rule.workflow);

  const exists = await s3Utils.fileExists(bucket, workflowFileKey);
  if (!exists) throw new Error(`Workflow doesn\'t exist: s3://${bucket}/${workflowFileKey} for ${rule.name}`);

  const definition = await s3Utils.getJsonS3Object(
    bucket,
    workflowFileKey
  );
  const template = await s3Utils.getJsonS3Object(bucket, workflows.templateKey(stack));

  return {
    template,
    definition,
    provider: rule.provider,
    collection: rule.collection,
    meta: get(rule, 'meta', {}),
    cumulus_meta: cumulusMeta || get(rule, 'cumulus_meta', {}),
    payload: get(rule, 'payload', {}),
    queueUrl: rule.queueUrl,
    executionNamePrefix: rule.executionNamePrefix,
    asyncOperationId: rule.asyncOperationId,
  };
}

/**
 * Queue a workflow message for the kinesis/sqs rule with the message passed
 * to stream/queue as the payload
 *
 * @param {RuleRecord} rule - rule to queue the message for
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

  const payload = await buildPayload(item);
  return handleScheduleEvent(payload);
}

/**
 * Check if a rule's event source mapping is shared with other rules
 *
 * @param {Knex}    knex      - DB client
 * @param {RuleRecord} rule   - the rule item
 * @param {Object}  eventType - the rule's event type
 * @returns {Promise<boolean>} return true if other rules share the same event source mapping
 */
async function isEventSourceMappingShared(knex, rule, eventType) {
  const rulePgModel = new RulePgModel();
  // Query for count of any other rule that has the same type and arn
  const params = {
    type: rule.rule.type,
    ...eventType,
  };
  const [result] = await rulePgModel.count(knex, [[params]]);

  return (result.count > 1);
}

/**
 * Deletes an event source from an event lambda function
 *
 * @param {Knex}    knex      - DB client
 * @param {RuleRecord} rule   - the rule item
 * @param {string}  eventType - kinesisSourceEvent type ['arn', 'log_event_arn']
 * @param {string}  id        - event source id
 * @returns {Promise} the response from event source delete
 */
async function deleteKinesisEventSource(knex, rule, eventType, id) {
  if (!(await isEventSourceMappingShared(knex, rule, id))) {
    const params = {
      UUID: id[eventType],
    };
    log.info(`Deleting event source with UUID ${id[eventType]}`);
    return awsServices.lambda().deleteEventSourceMapping(params).promise();
  }
  log.info(`Event source mapping is shared with another rule. Will not delete kinesis event source for ${rule.name}`);
  return undefined;
}

/**
 * Delete event source mappings for all mappings in the kinesisSourceEvents
 * @param {Knex} knex       - DB client
 * @param {RuleRecord} rule - the rule item
 * @returns {Promise<Array>} array of responses from the event source deletion
 */
async function deleteKinesisEventSources(knex, rule) {
  const kinesisSourceEvents = [
    {
      name: process.env.messageConsumer,
      eventType: 'arn',
      type: {
        arn: rule.rule.arn,
      },
    },
    {
      name: process.env.KinesisInboundEventLogger,
      eventType: 'log_event_arn',
      type: {
        log_event_arn: rule.rule.logEventArn,
      },
    },
  ];
  const deleteEventPromises = kinesisSourceEvents.map(
    (lambda) => deleteKinesisEventSource(knex, rule, lambda.eventType, lambda.type).catch(
      (error) => {
        log.error(`Error deleting eventSourceMapping for ${rule.name}: ${error}`);
        if (error.code !== 'ResourceNotFoundException') throw error;
      }
    )
  );
  return await Promise.all(deleteEventPromises);
}

/**
 * Delete a rule's SNS trigger
 * @param {Knex} knex       - DB client
 * @param {RuleRecord} rule - the rule item
 * @returns {Promise} the response from SNS unsubscribe
 */
async function deleteSnsTrigger(knex, rule) {
  // If event source mapping is shared by other rules, don't delete it
  if (await isEventSourceMappingShared(knex, rule, { arn: rule.rule.arn })) {
    log.info(`Event source mapping for ${JSON.stringify(rule)} with type 'arn' is shared by multiple rules, so it will not be deleted.`);
    return Promise.resolve();
  }
  // delete permission statement
  const permissionParams = {
    FunctionName: process.env.messageConsumer,
    StatementId: `${rule.name}Permission`,
  };
  try {
    await awsServices.lambda().removePermission(permissionParams).promise();
  } catch (error) {
    if (isResourceNotFoundException(error)) {
      throw new ResourceNotFoundError(error);
    }
    log.info(`Error attempting to delete permission statement ${JSON.stringify(error)}`);
    throw error;
  }
  // delete sns subscription
  const subscriptionParams = {
    SubscriptionArn: rule.rule.arn,
  };
  log.info(`Successfully deleted SNS subscription for ARN ${rule.rule.arn}.`);
  return awsServices.sns().unsubscribe(subscriptionParams).promise();
}

/**
 * Delete rule resources by rule type
 * @param {Knex}    knex - DB client
 * @param {RuleRecord} rule - Rule
 */
async function deleteRuleResources(knex, rule) {
  const type = rule.rule.type;
  log.info(`Initiating deletion of rule ${JSON.stringify(rule)}`);
  switch (type) {
  case 'scheduled': {
    const targetId = 'lambdaTarget';
    const name = `${process.env.stackName}-custom-${rule.name}`;
    await CloudwatchEvents.deleteTarget(targetId, name);
    await CloudwatchEvents.deleteEvent(name);
    break;
  }
  case 'kinesis': {
    await deleteKinesisEventSources(knex, rule);
    break;
  }
  case 'sns': {
    if (rule.state === 'ENABLED') {
      await deleteSnsTrigger(knex, rule);
    }
    break;
  }
  case 'sqs':
  default:
    break;
  }
}

/**
 * Update the event source mapping for SNS type rules.
 *
 * Avoids object mutation by cloning the original rule item.
 *
 * @param {RuleRecord} ruleItem - A rule item
 * @param {string} snsSubscriptionArn
 *   UUID for event source mapping from SNS topic to messageConsumer Lambda
 * @returns {RuleRecord} - Updated rule item
 */
function updateSnsRuleArn(ruleItem, snsSubscriptionArn) {
  const updatedRuleItem = cloneDeep(ruleItem);
  updatedRuleItem.rule.arn = snsSubscriptionArn;
  return updatedRuleItem;
}

/**
   * Validate and update sqs rule with queue property
   *
   * @param {RuleRecord} rule -  the sqs rule
   * @returns {RuleRecord} the updated sqs rule
   */
async function validateAndUpdateSqsRule(rule) {
  const queueUrl = rule.rule.value;
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
  if (!get(rule, 'meta.visibilityTimeout')) {
    set(rule, 'meta.visibilityTimeout', Number.parseInt(attributes.Attributes.VisibilityTimeout, 10));
  }

  if (!get(rule, 'meta.retries')) set(rule, 'meta.retries', 3);
  return rule;
}

/**
   * Add an event source to a target lambda function
   *
   * @param {RuleRecord} item   - The rule item
   * @param {string}  lambda - The name of the target lambda
   * @returns {Promise}
   */
async function addKinesisEventSource(item, lambda) {
  // use the existing event source mapping if it already exists and is enabled
  const listParams = {
    FunctionName: lambda.name,
    EventSourceArn: item.rule.value,
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
    EventSourceArn: item.rule.value,
    FunctionName: lambda.name,
    StartingPosition: 'TRIM_HORIZON',
    Enabled: true,
  };
  return awsServices.lambda().createEventSourceMapping(params).promise();
}

/**
 * Add event sources for all mappings in the kinesisSourceEvents
 * @param {RuleRecord} rule - The rule item
 * @returns {Object}     - Returns arn and logEventArn
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
 * Add SNS event sources
 *
 * @param {RuleRecord} item - The rule item
 * @returns {string}        - Returns snsSubscriptionArn
 */
async function addSnsTrigger(item) {
  // check for existing subscription
  let token;
  let subExists = false;
  let subscriptionArn;
  /* eslint-disable no-await-in-loop */
  do {
    const subsResponse = await awsServices.sns().listSubscriptionsByTopic({
      TopicArn: item.rule.value,
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
      TopicArn: item.rule.value,
      Protocol: 'lambda',
      Endpoint: process.env.messageConsumer,
      ReturnSubscriptionArn: true,
    };
    const r = await awsServices.sns().subscribe(subscriptionParams).promise();
    subscriptionArn = r.SubscriptionArn;
    // create permission to invoke lambda
    const permissionParams = {
      Action: 'lambda:InvokeFunction',
      FunctionName: process.env.messageConsumer,
      Principal: 'sns.amazonaws.com',
      SourceArn: item.rule.value,
      StatementId: `${item.name}Permission`,
    };
    await awsServices.lambda().addPermission(permissionParams).promise();
  }
  return subscriptionArn;
}

/**
 * Update the event source mappings for Kinesis type rules.
 *
 * Avoids object mutation by cloning the original rule item.
 *
 * @param {RuleRecord} ruleItem
 *   A rule item
 * @param {Object} ruleArns
 *   An object containing arn and logEventArn values
 * @param {string} ruleArns.arn
 *   UUID for event source mapping from Kinesis stream for messageConsumer Lambda
 * @param {string} ruleArns.logEventArn
 *   UUID for event source mapping from Kinesis stream to KinesisInboundEventLogger Lambda
 * @returns {RuleRecord}
 *   Updated rule item
 */
function updateKinesisRuleArns(ruleItem, ruleArns) {
  const updatedRuleItem = cloneDeep(ruleItem);
  updatedRuleItem.rule.arn = ruleArns.arn;
  updatedRuleItem.rule.logEventArn = ruleArns.logEventArn;
  return updatedRuleItem;
}

/**
   * Adds CloudWatch event rule and target
   *
   * @param {RuleRecord} item - The rule item
   * @param {Object} payload  - The payload input of the CloudWatch event
   * @returns {void}
   */
async function addRule(item, payload) {
  const name = `${process.env.stackName}-custom-${item.name}`;
  await CloudwatchEvents.putEvent(
    name,
    item.rule.value,
    item.state,
    'Rule created by cumulus-api'
  );
  const targetId = 'lambdaTarget';

  await CloudwatchEvents.putTarget(
    name,
    targetId,
    process.env.invokeArn,
    JSON.stringify(payload)
  );
}

/**
 * Checks if record is valid
 *
 * @param {RuleRecord} rule - Rule to check validation
 * @returns {void}          - Returns if record is valid, throws error otherwise
 */
function recordIsValid(rule) {
  const error = new Error('The record has validation errors. ');
  error.name = 'SchemaValidationError';
  if (!rule.name) {
    error.message += 'Rule name is undefined.';
    throw error;
  }
  if (!rule.workflow) {
    error.message += 'Rule workflow is undefined.';
    throw error;
  }
  if (!rule.rule.type) {
    error.message += 'Rule type is undefined.';
    throw error;
  }
}

/**
 * Invokes lambda for rule rerun
 *
 * @param {RuleRecord} rule
 *
 * @returns {Promise} lambda invocation response
 */
async function invokeRerun(rule) {
  const payload = await buildPayload(rule);
  await invoke(process.env.invoke, payload);
}

/**
 * Updates rule trigger for rule
 *
 * @param {RuleRecord} original - Rule to update trigger for
 * @param {Object} updates      - Updates for rule trigger
 * @param {Knex} knex           - Knex DB Client
 * @returns {RuleRecord}        - Returns new rule object
 */
async function updateRuleTrigger(original, updates, knex) {
  let clonedRuleItem = cloneDeep(original);
  let mergedRule = merge(clonedRuleItem, updates);
  recordIsValid(mergedRule);

  const stateChanged = updates.state && updates.state !== original.state;
  const valueUpdated = updates.rule.value !== original.rule.value;
  const enabled = mergedRule.state === 'ENABLED';

  switch (mergedRule.rule.type) {
  case 'scheduled': {
    const payload = await buildPayload(mergedRule);
    await addRule(mergedRule, payload);
    break;
  }
  case 'kinesis':
    if (valueUpdated) {
      await deleteKinesisEventSources(knex, mergedRule);
      const updatedRuleItemArns = await addKinesisEventSources(mergedRule);
      mergedRule = updateKinesisRuleArns(mergedRule,
        updatedRuleItemArns);
    }
    break;
  case 'sns': {
    if (valueUpdated || stateChanged) {
      if (enabled && stateChanged && mergedRule.rule.arn) {
        throw new Error('Including rule.arn is not allowed when enabling a disabled rule');
      }
      let snsSubscriptionArn;
      if (mergedRule.rule.arn) {
        await deleteSnsTrigger(knex, mergedRule);
      }
      if (enabled) {
        snsSubscriptionArn = await addSnsTrigger(mergedRule);
      }
      mergedRule = updateSnsRuleArn(mergedRule,
        snsSubscriptionArn);
    }
    break;
  }
  case 'sqs':
    clonedRuleItem = await validateAndUpdateSqsRule(mergedRule);
    break;
  case 'onetime':
    break;
  default:
    throw new ValidationError(`Rule type \'${mergedRule.rule.type}\' not supported.`);
  }

  return mergedRule;
}

/**
 * Creates rule trigger for rule
 *
 * @param {RuleRecord} ruleItem - Rule to create trigger for
 *
 * @returns {RuleRecord}        - Returns new rule object
 */
async function createRuleTrigger(ruleItem) {
  let newRuleItem = cloneDeep(ruleItem);
  // the default value for enabled is true
  if (newRuleItem.state === undefined) {
    newRuleItem.state = 'ENABLED';
  }
  const enabled = newRuleItem.state === 'ENABLED';

  // make sure the name only has word characters
  const re = /\W/;
  if (re.test(ruleItem.name)) {
    throw new ValidationError('Rule name may only contain letters, numbers, and underscores.');
  }

  // Validate rule before kicking off workflows or adding event source mappings
  recordIsValid(newRuleItem);

  const payload = await buildPayload(newRuleItem);
  switch (newRuleItem.rule.type) {
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
    if (enabled) {
      const snsSubscriptionArn = await addSnsTrigger(newRuleItem);
      newRuleItem = updateSnsRuleArn(newRuleItem, snsSubscriptionArn);
    }
    break;
  }
  case 'sqs':
    newRuleItem = await validateAndUpdateSqsRule(newRuleItem);
    break;
  default:
    throw new ValidationError(`Rule type \'${newRuleItem.rule.type}\' not supported.`);
  }
  return newRuleItem;
}

module.exports = {
  buildPayload,
  createRuleTrigger,
  deleteKinesisEventSource,
  deleteKinesisEventSources,
  deleteRuleResources,
  deleteSnsTrigger,
  fetchAllRules,
  fetchEnabledRules,
  fetchRules,
  filterRulesbyCollection,
  filterRulesByRuleParams,
  getMaxTimeoutForRules,
  invokeRerun,
  isEventSourceMappingShared,
  lookupCollectionInEvent,
  queueMessageForRule,
  updateRuleTrigger,
};

//@ts-check

'use strict';

const cloneDeep = require('lodash/cloneDeep');
const get = require('lodash/get');
const isNull = require('lodash/isNull');
const set = require('lodash/set');

const awsServices = require('@cumulus/aws-client/services');
const CloudwatchEvents = require('@cumulus/aws-client/CloudwatchEvents');
const Logger = require('@cumulus/logger');
const s3Utils = require('@cumulus/aws-client/S3');
const workflows = require('@cumulus/common/workflows');
const { sqsQueueExists } = require('@cumulus/aws-client/SQS');
const { sendUnsubscribeCommand,
  sendListSubscriptionsCommand,
  sendSubscribeCommand } = require('@cumulus/aws-client/SNS');
const { invoke } = require('@cumulus/aws-client/Lambda');
const { RulePgModel } = require('@cumulus/db');
const { ValidationError } = require('@cumulus/errors');
const { getRequiredEnvVar } = require('@cumulus/common/env');

const { listRules } = require('@cumulus/api-client/rules');
const { omitDeepBy, removeNilProperties } = require('@cumulus/common/util');

const { handleScheduleEvent } = require('../lambdas/sf-scheduler');
const { isResourceNotFoundException, ResourceNotFoundError } = require('./errors');
const { getSnsTriggerPermissionId } = require('./snsRuleHelpers');
const { recordIsValid } = require('./schema');
const ruleSchema = require('./schemas').rule;

/**
 * @typedef {import('@cumulus/types/api/rules').RuleRecord} RuleRecord
 * @typedef {import('knex').Knex} Knex
 */

const log = new Logger({ sender: '@cumulus/rulesHelpers' });

/**
 * fetch all rules in the Cumulus API
 *
 * @param {Object} params - function params
 * @param {number} [params.pageNumber] - current page of API results
 * @param {Array<Object>} [params.rules] - partial rules Array
 * @param {Object} [params.queryParams] - API query params, empty query returns all rules
 * @returns {Promise<Array<Object>>} all matching rules
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

async function fetchEnabledRules() {
  return await fetchRules({ queryParams: { state: 'ENABLED' } });
}

const collectionRuleMatcher = (rule, collection, logger = log) => {
  // Match as much collection info as we found in the message
  const ruleCollectionName = get(rule, 'collection.name');
  const ruleCollectionVersion = get(rule, 'collection.version');

  const nameMatch = collection.name
    ? ruleCollectionName === collection.name
    : true;
  const versionMatch = collection.version
    ? ruleCollectionVersion === collection.version
    : true;

  if (!nameMatch || !versionMatch) {
    logger.info(`Rule collection name - ${ruleCollectionName} - or Rule collection version - ${ruleCollectionVersion} - does not match collection - ${JSON.stringify(collection)}`);
  }

  return nameMatch && versionMatch;
};

const filterRulesbyCollection = (rules, collection = {}, logger = log) => rules.filter(
  (rule) => collectionRuleMatcher(rule, collection, logger)
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
 *
 * @returns {Promise<unknown>} lambda invocation payload
 */
async function buildPayload(rule) {
  // makes sure the workflow exists
  const bucket = getRequiredEnvVar('system_bucket');
  const stack = getRequiredEnvVar('stackName');
  const workflowFileKey = workflows.getWorkflowFileKey(stack, rule.workflow);

  const exists = await s3Utils.fileExists(bucket, workflowFileKey);
  if (!exists) throw new Error(`Workflow doesn\'t exist: s3://${bucket}/${workflowFileKey} for ${rule.name}`);

  const fullDefinition = await s3Utils.getJsonS3Object(
    bucket,
    workflowFileKey
  );
  const template = await s3Utils.getJsonS3Object(bucket, workflows.templateKey(stack));

  return {
    template,
    definition: {
      name: fullDefinition.name,
      arn: fullDefinition.arn,
    },
    provider: rule.provider,
    collection: rule.collection,
    meta: get(rule, 'meta', {}),
    cumulus_meta: get(rule, 'cumulus_meta', {}),
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
 * @param {{log_event_arn?: string, arn?: string}} id        - event source id
 * @returns {Promise} the response from event source delete
 */
async function deleteKinesisEventSource(knex, rule, eventType, id) {
  if (!(await isEventSourceMappingShared(knex, rule, id))) {
    const params = {
      UUID: id[eventType],
    };
    log.info(`Deleting event source with UUID ${id[eventType]}`);
    return awsServices.lambda().deleteEventSourceMapping(params);
  }
  log.info(`Event source mapping is shared with another rule. Will not delete kinesis event source for ${rule.name}`);
  return undefined;
}

// @typedef { typeof deleteKinesisEventSource } deleteKinesisEventSource

/**
 * Delete event source mappings for all mappings in the kinesisSourceEvents
 *
 * @param {Knex} knex       - DB client
 * @param {RuleRecord} rule - the rule item
 * @param {{deleteKinesisEventSourceMethod: deleteKinesisEventSource}} testContext -
 * @returns {Promise<Array>} array of responses from the event source deletion
 */
async function deleteKinesisEventSources(knex, rule, testContext = {
  deleteKinesisEventSourceMethod: deleteKinesisEventSource,
}) {
  const deleteKinesisEventSourceMethod = testContext.deleteKinesisEventSourceMethod;
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
    (lambda) => deleteKinesisEventSourceMethod(knex, rule, lambda.eventType, lambda.type).catch(
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
    StatementId: getSnsTriggerPermissionId(rule),
  };
  try {
    await awsServices.lambda().removePermission(permissionParams);
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
  return await sendUnsubscribeCommand(subscriptionParams);
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
    const name = `${process.env.stackName}-${rule.name}`;
    await CloudwatchEvents.deleteTarget(targetId, name);
    await CloudwatchEvents.deleteEvent(name);
    break;
  }
  case 'kinesis': {
    await deleteKinesisEventSources(knex, rule);
    break;
  }
  case 'sns': {
    if (rule.rule.arn) {
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
   * @returns {Promise<RuleRecord>} the updated sqs rule
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
   * @param {{ name: string | undefined}}  lambda - The name of the target lambda
   * @returns {Promise}
   */
async function addKinesisEventSource(item, lambda) {
  // use the existing event source mapping if it already exists and is enabled
  const listParams = {
    FunctionName: lambda.name,
    EventSourceArn: item.rule.value,
  };
  const listData = await awsServices.lambda().listEventSourceMappings(listParams);
  if (listData.EventSourceMappings && listData.EventSourceMappings.length > 0) {
    const currentMapping = listData.EventSourceMappings[0];

    // This is for backwards compatibility. Mappings should no longer be disabled.
    if (currentMapping.State === 'Enabled') {
      return currentMapping;
    }
    return awsServices.lambda().updateEventSourceMapping({
      UUID: currentMapping.UUID,
      Enabled: true,
    });
  }

  // create event source mapping
  const params = {
    EventSourceArn: item.rule.value,
    FunctionName: lambda.name,
    StartingPosition: 'TRIM_HORIZON',
    Enabled: true,
  };
  return awsServices.lambda().createEventSourceMapping(params);
}

/**
 * Add event sources for all mappings in the kinesisSourceEvents
 * @param {RuleRecord} rule - The rule item
 * @returns {Promise<Object>}     - Returns arn and logEventArn
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
 * Checks for existing SNS subscriptions
 *
 * @param {RuleRecord} ruleItem - Rule to check
 *
 * @returns {Object}
 *  subExists - boolean
 *  existingSubscriptionArn - ARN of subscription
 */
async function checkForSnsSubscriptions(ruleItem) {
  let token;
  let subExists = false;
  let subscriptionArn;
  /* eslint-disable no-await-in-loop */
  do {
    const subsResponse = await sendListSubscriptionsCommand(({
      TopicArn: ruleItem.rule.value,
      NextToken: token,
    }));
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
  return {
    subExists,
    existingSubscriptionArn: subscriptionArn,
  };
}

/**
 * Add SNS event sources
 *
 * @param {RuleRecord} item - The rule item
 * @returns {Promise<string>} - Returns snsSubscriptionArn
 */
async function addSnsTrigger(item) {
  const {
    subExists,
    existingSubscriptionArn,
  } = await checkForSnsSubscriptions(item);
  let subscriptionArn = existingSubscriptionArn;

  /* eslint-enable no-await-in-loop */
  if (!subExists) {
    // create sns subscription
    const subscriptionParams = {
      TopicArn: item.rule.value,
      Protocol: 'lambda',
      Endpoint: process.env.messageConsumer,
      ReturnSubscriptionArn: true,
    };
    const r = await sendSubscribeCommand(subscriptionParams);
    subscriptionArn = r.SubscriptionArn;
    // create permission to invoke lambda
    const permissionParams = {
      Action: 'lambda:InvokeFunction',
      FunctionName: process.env.messageConsumer,
      Principal: 'sns.amazonaws.com',
      SourceArn: item.rule.value,
      StatementId: getSnsTriggerPermissionId(item),
    };
    await awsServices.lambda().addPermission(permissionParams);
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
   * @param {unknown} payload  - The payload input of the CloudWatch event
   * @returns {void}
   */
async function addRule(item, payload) {
  const name = `${process.env.stackName}-${item.name}`;
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
function validateRecord(rule) {
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
  if (!rule.rule || !rule.rule.type) {
    error.message += 'Rule type is undefined.';
    throw error;
  }

  recordIsValid(omitDeepBy(rule, isNull), ruleSchema, false);

  if (rule.rule.type !== 'onetime' && !rule.rule.value) {
    error.message += `Rule value is undefined for ${rule.rule.type} rule`;
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
  if (rule.state !== 'DISABLED') {
    const payload = await buildPayload(rule);
    await invoke(process.env.invoke, payload);
  } else {
    log.error(`Cannot re-run rule ${rule.name} with a ${rule.state} state, please enable the rule and re-run.`);
    throw new Error(`Cannot re-run rule ${rule.name} with a ${rule.state} state, please enable the rule and re-run.`);
  }
}

/**
 * Updates rule trigger for rule
 *
 * @param {RuleRecord} original - Rule to update trigger for
 * @param {RuleRecord} updated  - Updated rule for rule trigger
 * @returns {Promise<RuleRecord>}        - Returns new rule object
 */
async function updateRuleTrigger(original, updated) {
  let resultRule = cloneDeep(updated);
  validateRecord(resultRule);

  const stateChanged = updated.state && updated.state !== original.state;
  const valueUpdated = updated.rule && updated.rule.value !== original.rule.value;
  const enabled = resultRule.state === 'ENABLED';

  switch (resultRule.rule.type) {
  case 'scheduled': {
    const payload = await buildPayload(resultRule);
    await addRule(resultRule, payload);
    break;
  }
  case 'kinesis':
    if (valueUpdated) {
      const updatedRuleItemArns = await addKinesisEventSources(resultRule);
      resultRule = updateKinesisRuleArns(resultRule,
        updatedRuleItemArns);
    }
    break;
  case 'sns': {
    if (valueUpdated || stateChanged) {
      if (enabled && stateChanged && resultRule.rule.arn) {
        throw new Error('Including rule.arn is not allowed when enabling a disabled rule');
      }

      let snsSubscriptionArn;
      if (enabled) {
        snsSubscriptionArn = await addSnsTrigger(resultRule);
      }
      resultRule = updateSnsRuleArn(resultRule, snsSubscriptionArn);
    }
    break;
  }
  case 'sqs':
    resultRule = await validateAndUpdateSqsRule(resultRule);
    break;
  case 'onetime':
    break;
  default:
    throw new ValidationError(`Rule type \'${resultRule.rule.type}\' not supported.`);
  }

  return resultRule;
}

/**
 * Creates rule trigger for rule
 *
 * @param {RuleRecord} ruleItem - Rule to create trigger for
 * @param {Object} testParams - Function to determine to use actual invoke or testInvoke
 * @returns {Promise<RuleRecord>} - Returns new rule object
 */
async function createRuleTrigger(ruleItem, testParams = {}) {
  let newRuleItem = cloneDeep(ruleItem);
  // the default value for enabled is true
  if (newRuleItem.state === undefined) {
    newRuleItem.state = 'ENABLED';
  }

  const enabled = newRuleItem.state === 'ENABLED';
  const invokeMethod = testParams.invokeMethod || invoke;
  // make sure the name only has word characters
  const re = /\W/;
  if (re.test(ruleItem.name)) {
    throw new ValidationError('Rule name may only contain letters, numbers, and underscores.');
  }

  // Validate rule before kicking off workflows or adding event source mappings
  validateRecord(newRuleItem);

  const payload = await buildPayload(newRuleItem);
  switch (newRuleItem.rule.type) {
  case 'onetime': {
    if (enabled) {
      await invokeMethod(process.env.invoke, payload);
    }
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
  checkForSnsSubscriptions,
  createRuleTrigger,
  deleteKinesisEventSource,
  deleteKinesisEventSources,
  deleteRuleResources,
  deleteSnsTrigger,
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

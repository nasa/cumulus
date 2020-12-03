'use strict';

const cloneDeep = require('lodash/cloneDeep');
const get = require('lodash/get');
const merge = require('lodash/merge');
const set = require('lodash/set');

const awsServices = require('@cumulus/aws-client/services');
const CloudwatchEvents = require('@cumulus/aws-client/CloudwatchEvents');
const log = require('@cumulus/common/log');
const s3Utils = require('@cumulus/aws-client/S3');
const workflows = require('@cumulus/common/workflows');
const { invoke } = require('@cumulus/aws-client/Lambda');
const { sqsQueueExists } = require('@cumulus/aws-client/SQS');
const { ValidationError } = require('@cumulus/errors');
const { getMessageRules } = require('@cumulus/message/Rules');

const Manager = require('./base');
const { rule: ruleSchema } = require('./schemas');

class Rule extends Manager {
  constructor() {
    super({
      tableName: process.env.RulesTable,
      tableHash: { name: 'name', type: 'S' },
      schema: ruleSchema,
    });

    this.eventMapping = { arn: 'arn', logEventArn: 'logEventArn' };
    this.kinesisSourceEvents = [{ name: process.env.messageConsumer, eventType: 'arn' },
      { name: process.env.KinesisInboundEventLogger, eventType: 'logEventArn' }];
    this.targetId = 'lambdaTarget';
  }

  async addRule(item, payload) {
    const name = `${process.env.stackName}-custom-${item.name}`;
    const r = await CloudwatchEvents.putEvent(
      name,
      item.rule.value,
      item.state,
      'Rule created by cumulus-api'
    );

    await CloudwatchEvents.putTarget(
      name,
      this.targetId,
      process.env.invokeArn,
      JSON.stringify(payload)
    );
    return r.RuleArn;
  }

  async deleteRules() {
    const rules = await this.scan();
    const deletePromises = rules.Items.map((r) => this.delete(r));
    return Promise.all(deletePromises);
  }

  async delete(item) {
    switch (item.rule.type) {
    case 'scheduled': {
      const name = `${process.env.stackName}-custom-${item.name}`;
      await CloudwatchEvents.deleteTarget(this.targetId, name);
      await CloudwatchEvents.deleteEvent(name);
      break;
    }
    case 'kinesis': {
      await this.deleteKinesisEventSources(item);
      break;
    }
    case 'sns': {
      if (item.state === 'ENABLED') {
        await this.deleteSnsTrigger(item);
      }
      break;
    }
    case 'sqs':
    default:
      break;
    }
    return super.delete({ name: item.name });
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
  updateKinesisRuleArns(ruleItem, ruleArns) {
    const updatedRuleItem = cloneDeep(ruleItem);
    updatedRuleItem.rule.arn = ruleArns.arn;
    updatedRuleItem.rule.logEventArn = ruleArns.logEventArn;
    return updatedRuleItem;
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
  updateSnsRuleArn(ruleItem, snsSubscriptionArn) {
    const updatedRuleItem = cloneDeep(ruleItem);
    if (!snsSubscriptionArn) {
      delete updatedRuleItem.rule.arn;
    } else {
      updatedRuleItem.rule.arn = snsSubscriptionArn;
    }
    return updatedRuleItem;
  }

  /**
   * Updates a rule item.
   *
   * @param {Object} original - the original rule
   * @param {Object} updates - key/value fields for update; might not be a
   *    complete rule item
   * @param {Array<string>} [fieldsToDelete] - names of fields to delete from
   *    rule
   * @returns {Promise} the response from database updates
   */
  async update(original, updates, fieldsToDelete = []) {
    // Make a copy of the existing rule to preserve existing values
    let updatedRuleItem = cloneDeep(original);

    // Apply updates to updated rule item to be saved
    merge(updatedRuleItem, updates);

    // Validate rule before kicking off workflows or adding event source mappings
    await this.constructor.recordIsValid(updatedRuleItem, this.schema, this.removeAdditional);

    const stateChanged = updates.state && updates.state !== original.state;
    const valueUpdated = updates.rule && updates.rule.value !== original.rule.value;

    updatedRuleItem = await this.updateRuleTrigger(updatedRuleItem, stateChanged, valueUpdated);

    return super.update({ name: original.name }, updatedRuleItem,
      fieldsToDelete);
  }

  async updateRuleTrigger(ruleItem, stateChanged, valueUpdated) {
    let updatedRuleItem = cloneDeep(ruleItem);

    switch (updatedRuleItem.rule.type) {
    case 'scheduled': {
      const payload = await Rule.buildPayload(updatedRuleItem);
      await this.addRule(updatedRuleItem, payload);
      break;
    }
    case 'kinesis':
      if (valueUpdated) {
        await this.deleteKinesisEventSources(updatedRuleItem);
        const updatedRuleItemArns = await this.addKinesisEventSources(updatedRuleItem);
        updatedRuleItem = this.updateKinesisRuleArns(updatedRuleItem,
          updatedRuleItemArns);
      }
      break;
    case 'sns': {
      if (valueUpdated || stateChanged) {
        if (updatedRuleItem.state === 'ENABLED' && stateChanged && updatedRuleItem.rule.arn) {
          throw new Error('Including rule.arn is not allowed when enabling a disabled rule');
        }
        let snsSubscriptionArn;
        if (updatedRuleItem.rule.arn) {
          await this.deleteSnsTrigger(updatedRuleItem);
        }
        if (updatedRuleItem.state === 'ENABLED') {
          snsSubscriptionArn = await this.addSnsTrigger(updatedRuleItem);
        }
        updatedRuleItem = this.updateSnsRuleArn(updatedRuleItem,
          snsSubscriptionArn);
      }
      break;
    }
    case 'sqs':
      updatedRuleItem = await this.validateAndUpdateSqsRule(updatedRuleItem);
      break;
    default:
      break;
    }

    return updatedRuleItem;
  }

  static async buildPayload(item) {
    // makes sure the workflow exists
    const bucket = process.env.system_bucket;
    const stack = process.env.stackName;
    const workflowFileKey = workflows.getWorkflowFileKey(stack, item.workflow);

    const exists = await s3Utils.fileExists(bucket, workflowFileKey);
    if (!exists) throw new Error(`Workflow doesn\'t exist: s3://${bucket}/${workflowFileKey} for ${item.name}`);

    const definition = await s3Utils.getJsonS3Object(
      bucket,
      workflowFileKey
    );
    const template = await s3Utils.getJsonS3Object(bucket, workflows.templateKey(stack));

    return {
      template,
      definition,
      provider: item.provider,
      collection: item.collection,
      meta: get(item, 'meta', {}),
      cumulus_meta: get(item, 'cumulus_meta', {}),
      payload: get(item, 'payload', {}),
      queueUrl: item.queueUrl,
      asyncOperationId: item.asyncOperationId,
      executionNamePrefix: item.executionNamePrefix,
    };
  }

  static async invoke(item) {
    const payload = await Rule.buildPayload(item);
    await invoke(process.env.invoke, payload);
  }

  async create(item) {
    // make sure the name only has word characters
    const re = /\W/;
    if (re.test(item.name)) {
      throw new ValidationError('Rule name may only contain letters, numbers, and underscores.');
    }

    // Initialize new rule object
    let newRuleItem = cloneDeep(item);

    // the default state is 'ENABLED'
    if (!item.state) {
      newRuleItem.state = 'ENABLED';
    }

    newRuleItem.createdAt = Date.now();
    newRuleItem.updatedAt = Date.now();

    // Validate rule before kicking off workflows or adding event source mappings
    await this.constructor.recordIsValid(newRuleItem, this.schema, this.removeAdditional);

    newRuleItem = await this.createRuleTrigger(newRuleItem);

    // save
    return super.create(newRuleItem);
  }

  async createRuleTrigger(ruleItem) {
    let newRuleItem = cloneDeep(ruleItem);

    const payload = await Rule.buildPayload(newRuleItem);
    switch (newRuleItem.rule.type) {
    case 'onetime': {
      await invoke(process.env.invoke, payload);
      break;
    }
    case 'scheduled': {
      await this.addRule(newRuleItem, payload);
      break;
    }
    case 'kinesis': {
      const ruleArns = await this.addKinesisEventSources(newRuleItem);
      newRuleItem = this.updateKinesisRuleArns(newRuleItem, ruleArns);
      break;
    }
    case 'sns': {
      if (newRuleItem.state === 'ENABLED') {
        const snsSubscriptionArn = await this.addSnsTrigger(newRuleItem);
        newRuleItem = this.updateSnsRuleArn(newRuleItem, snsSubscriptionArn);
      }
      break;
    }
    case 'sqs':
      newRuleItem = await this.validateAndUpdateSqsRule(newRuleItem);
      break;
    default:
      throw new ValidationError(`Rule type \'${newRuleItem.rule.type}\' not supported.`);
    }
    return newRuleItem;
  }

  /**
   * Add  event sources for all mappings in the kinesisSourceEvents
   * @param {Object} item - the rule item
   * @returns {Object} return updated rule item containing new arn/logEventArn
   */
  async addKinesisEventSources(item) {
    const sourceEventPromises = this.kinesisSourceEvents.map(
      (lambda) => this.addKinesisEventSource(item, lambda).catch(
        (error) => {
          log.error(`Error adding eventSourceMapping for ${item.name}: ${error}`);
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
   * add an event source to a target lambda function
   *
   * @param {Object} item - the rule item
   * @param {string} lambda - the name of the target lambda
   * @returns {Promise} a promise
   * @returns {Promise} updated rule item
   */
  async addKinesisEventSource(item, lambda) {
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
   * Delete event source mappings for all mappings in the kinesisSourceEvents
   * @param {Object} item - the rule item
   * @returns {Promise<Array>} array of responses from the event source deletion
   */
  async deleteKinesisEventSources(item) {
    const deleteEventPromises = this.kinesisSourceEvents.map(
      (lambda) => this.deleteKinesisEventSource(item, lambda.eventType).catch(
        (error) => {
          log.error(`Error deleting eventSourceMapping for ${item.name}: ${error}`);
          if (error.code !== 'ResourceNotFoundException') throw error;
        }
      )
    );
    return Promise.all(deleteEventPromises);
  }

  /**
   * deletes an event source from an event lambda function
   *
   * @param {Object} item - the rule item
   * @param {string} eventType - kinesisSourceEvent Type
   * @returns {Promise} the response from event source delete
   */
  async deleteKinesisEventSource(item, eventType) {
    if (await this.isEventSourceMappingShared(item, eventType)) {
      return undefined;
    }
    const params = {
      UUID: item.rule[this.eventMapping[eventType]],
    };
    return awsServices.lambda().deleteEventSourceMapping(params).promise();
  }

  /**
   * check if a rule's event source mapping is shared with other rules
   *
   * @param {Object} item - the rule item
   * @param {string} eventType - kinesisSourceEvent Type
   * @returns {Promise<boolean>} return true if other rules share the same event source mapping
   */
  async isEventSourceMappingShared(item, eventType) {
    const arnClause = `#rl.#${this.eventMapping[eventType]} = :${this.eventMapping[eventType]}`;
    const queryNames = {
      '#nm': 'name',
      '#rl': 'rule',
      '#tp': 'type',
    };
    queryNames[`#${eventType}`] = eventType;

    const queryValues = {
      ':name': item.name,
      ':ruleType': item.rule.type,
    };
    queryValues[`:${eventType}`] = item.rule[eventType];

    const rules = await super.scan({
      names: queryNames,
      filter: `#nm <> :name AND #rl.#tp = :ruleType AND ${arnClause}`,
      values: queryValues,
    });

    return (rules.Count && rules.Count > 0);
  }

  async addSnsTrigger(item) {
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
    }
    // create permission to invoke lambda
    const permissionParams = {
      Action: 'lambda:InvokeFunction',
      FunctionName: process.env.messageConsumer,
      Principal: 'sns.amazonaws.com',
      SourceArn: item.rule.value,
      StatementId: `${item.name}Permission`,
    };
    await awsServices.lambda().addPermission(permissionParams).promise();
    return subscriptionArn;
  }

  async deleteSnsTrigger(item) {
    // If event source mapping is shared by other rules, don't delete it
    if (await this.isEventSourceMappingShared(item, 'arn')) {
      return Promise.resolve();
    }
    // delete permission statement
    const permissionParams = {
      FunctionName: process.env.messageConsumer,
      StatementId: `${item.name}Permission`,
    };
    await awsServices.lambda().removePermission(permissionParams).promise();
    // delete sns subscription
    const subscriptionParams = {
      SubscriptionArn: item.rule.arn,
    };
    return awsServices.sns().unsubscribe(subscriptionParams).promise();
  }

  /**
   * validate and update sqs rule with queue property
   *
   * @param {Object} rule the sqs rule
   * @returns {Object} the updated sqs rule
   */
  async validateAndUpdateSqsRule(rule) {
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
   * `queryRules` scans and returns rules in the DynamoDB table based on:
   *
   * - `rule.type`
   * - `rule.state` (ENABLED or DISABLED)
   * - sourceArn in the `rule.value` field
   * - collection name and version in `rule.collection`
   *
   * @param {Object} queryParams - query params for filtering rules
   * @param {string} queryParams.name - a collection name
   * @param {string} queryParams.version - a collection version
   * @param {string} queryParams.sourceArn - the ARN of the message source for the rule
   * @param {string} queryParams.state - "ENABLED" or "DISABLED"
   * @param {string} queryParams.type - "kinesis", "sns" "sqs", or "onetime"
   * @returns {Array} List of zero or more rules found from table scan
   * @throws {Error}
   */
  async queryRules({
    name,
    version,
    sourceArn,
    state = 'ENABLED',
    type,
  }) {
    if (!['kinesis', 'sns', 'sqs', 'onetime'].includes(type)) {
      throw new Error(`Unrecognized rule type: ${type}. Expected "kinesis", "sns", "sqs", or "onetime"`);
    }
    const names = {
      '#st': 'state',
      '#rl': 'rule',
      '#tp': 'type',
    };
    let filter = '#st = :enabledState AND #rl.#tp = :ruleType';
    const values = {
      ':enabledState': state,
      ':ruleType': type,
    };
    if (name) {
      values[':collectionName'] = name;
      names['#col'] = 'collection';
      names['#nm'] = 'name';
      filter += ' AND #col.#nm = :collectionName';
    }
    if (version) {
      values[':collectionVersion'] = version;
      names['#col'] = 'collection';
      names['#vr'] = 'version';
      filter += ' AND #col.#vr = :collectionVersion';
    }
    if (sourceArn) {
      values[':ruleValue'] = sourceArn;
      names['#vl'] = 'value';
      filter += ' AND #rl.#vl = :ruleValue';
    }
    const rulesQueryResultsForSourceArn = await this.scan({
      names,
      filter,
      values,
    });

    const rules = rulesQueryResultsForSourceArn.Items || [];
    if (rules.length === 0) {
      throw new Error(
        `No rules found that matched any/all of source ARN ${sourceArn} and `
        + `collection { name: ${name}, version: ${version} }`
      );
    }
    return rules;
  }

  /**
   * Generate an rule record from a Cumulus message.
   *
   * @param {Object} rule - A rule
   * @returns {Object} A rule record
   */
  static generateRuleRecord(rule) {
    const now = Date.now();

    const record = {
      name: rule.name,
      workflow: rule.workflow,
      provider: rule.provider,
      collection: rule.collection,
      meta: rule.meta,
      payload: rule.payload,
      queueUrl: rule.queueUrl,
      rule: rule.rule,
      state: rule.state,
      createdAt: rule.createdAt,
      updatedAt: now,
      tags: rule.tags,
      executionNamePrefix: rule.executionNamePrefix,
    };

    return record;
  }

  /**
   * Generate a rule record from a Cumulus message and store it in DynamoDB.
   *
   * @param {Object} params
   * @param {Object} params.rule - Granule object from a Cumulus message
   * @returns {Promise<Object|undefined>}
   * @throws
   */
  async storeRuleFromCumulusMessage({
    rule,
  }) {
    const ruleRecord = await Rule.generateRuleRecord(rule);
    const result = this.update(ruleRecord, ruleRecord);
    return result;
  }

  /**
   * Generate and store rule records from a Cumulus message.
   *
   * @param {Object} cumulusMessage - Cumulus workflow message
   * @returns {Promise}
   */
  async storeRulesFromCumulusMessage(cumulusMessage) {
    const rules = getMessageRules(cumulusMessage);
    if (rules.length === 0) {
      log.info(`No rules to process in the payload: ${JSON.stringify(cumulusMessage.payload)}`);
      return rules;
    }

    return Promise.all(rules.map(
      (rule) =>
        this.storeRuleFromCumulusMessage({
          rule,
        }).catch(log.error)
    ));
  }
}

module.exports = Rule;

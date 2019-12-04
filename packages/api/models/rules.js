'use strict';

const cloneDeep = require('lodash.clonedeep');
const get = require('lodash.get');
const merge = require('lodash.merge');
const set = require('lodash.set');
const { invoke, Events } = require('@cumulus/ingest/aws');
const aws = require('@cumulus/common/aws');
const workflows = require('@cumulus/common/workflows');
const Manager = require('./base');
const { rule: ruleSchema } = require('./schemas');

class Rule extends Manager {
  constructor() {
    super({
      tableName: process.env.RulesTable,
      tableHash: { name: 'name', type: 'S' },
      schema: ruleSchema
    });

    this.eventMapping = { arn: 'arn', logEventArn: 'logEventArn' };
    this.kinesisSourceEvents = [{ name: process.env.messageConsumer, eventType: 'arn' },
      { name: process.env.KinesisInboundEventLogger, eventType: 'logEventArn' }];
    this.targetId = 'lambdaTarget';
  }

  async addRule(item, payload) {
    const name = `${process.env.stackName}-custom-${item.name}`;
    const r = await Events.putEvent(
      name,
      item.rule.value,
      item.state,
      'Rule created by cumulus-api'
    );

    await Events.putTarget(name, this.targetId, process.env.invokeArn, JSON.stringify(payload));
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
      await Events.deleteTarget(this.targetId, name);
      await Events.deleteEvent(name);
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

    const stateChanged = (updates.state && updates.state !== original.state);
    const valueUpdated = (updates.rule
      && updates.rule.value !== original.rule.value);

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

    return super.update({ name: original.name }, updatedRuleItem,
      fieldsToDelete);
  }

  static async buildPayload(item) {
    // makes sure the workflow exists
    const bucket = process.env.system_bucket;
    const stack = process.env.stackName;
    const key = `${stack}/workflows/${item.workflow}.json`;
    const exists = await aws.fileExists(bucket, key);

    if (!exists) throw new Error(`Workflow doesn\'t exist: s3://${bucket}/${key} for ${item.name}`);

    const definition = await workflows.getWorkflowFile(stack, bucket, item.workflow);
    const template = await workflows.getWorkflowTemplate(stack, bucket);
    return {
      template,
      definition,
      provider: item.provider,
      collection: item.collection,
      meta: get(item, 'meta', {}),
      cumulus_meta: get(item, 'cumulus_meta', {}),
      payload: get(item, 'payload', {}),
      queueName: item.queueName,
      asyncOperationId: item.asyncOperationId
    };
  }

  static async invoke(item) {
    const payload = await Rule.buildPayload(item);
    await invoke(process.env.invoke, payload);
  }

  async create(item) {
    // make sure the name only has word characters
    const re = /[^\w]/;
    if (re.test(item.name)) {
      throw new Error('Names may only contain letters, numbers, and underscores.');
    }

    // Initialize new rule object
    let newRuleItem = cloneDeep(item);

    // the default state is 'ENABLED'
    if (!item.state) {
      newRuleItem.state = 'ENABLED';
    }

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
      throw new Error('Type not supported');
    }

    // save
    return super.create(newRuleItem);
  }


  /**
   * Add  event sources for all mappings in the kinesisSourceEvents
   * @param {Object} item - the rule item
   * @returns {Object} return updated rule item containing new arn/logEventArn
   */
  async addKinesisEventSources(item) {
    const sourceEventPromises = this.kinesisSourceEvents.map(
      (lambda) => this.addKinesisEventSource(item, lambda)
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
      EventSourceArn: item.rule.value
    };
    const listData = await aws.lambda().listEventSourceMappings(listParams).promise();
    if (listData.EventSourceMappings && listData.EventSourceMappings.length > 0) {
      const currentMapping = listData.EventSourceMappings[0];

      // This is for backwards compatibility. Mappings should no longer be disabled.
      if (currentMapping.State === 'Enabled') {
        return currentMapping;
      }
      return aws.lambda().updateEventSourceMapping({
        UUID: currentMapping.UUID,
        Enabled: true
      }).promise();
    }

    // create event source mapping
    const params = {
      EventSourceArn: item.rule.value,
      FunctionName: lambda.name,
      StartingPosition: 'TRIM_HORIZON',
      Enabled: true
    };
    return aws.lambda().createEventSourceMapping(params).promise();
  }

  /**
   * Delete event source mappings for all mappings in the kinesisSourceEvents
   * @param {Object} item - the rule item
   * @returns {Promise<Array>} array of responses from the event source deletion
   */
  async deleteKinesisEventSources(item) {
    const deleteEventPromises = this.kinesisSourceEvents.map(
      (lambda) => this.deleteKinesisEventSource(item, lambda.eventType)
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
      UUID: item.rule[this.eventMapping[eventType]]
    };
    return aws.lambda().deleteEventSourceMapping(params).promise();
  }

  /**
   * check if a rule's event source mapping is shared with other rules
   *
   * @param {Object} item - the rule item
   * @param {string} eventType - kinesisSourceEvent Type
   * @returns {boolean} return true if no other rules share the same event source mapping
   */
  async isEventSourceMappingShared(item, eventType) {
    const arnClause = `#rl.#${this.eventMapping[eventType]} = :${this.eventMapping[eventType]}`;
    const queryNames = {
      '#nm': 'name',
      '#rl': 'rule',
      '#tp': 'type'
    };
    queryNames[`#${eventType}`] = eventType;

    const queryValues = {
      ':name': item.name,
      ':ruleType': item.rule.type
    };
    queryValues[`:${eventType}`] = item.rule[eventType];

    const kinesisRules = await super.scan({
      names: queryNames,
      filter: `#nm <> :name AND #rl.#tp = :ruleType AND ${arnClause}`,
      values: queryValues
    });

    return (kinesisRules.Count && kinesisRules.Count > 0);
  }

  async addSnsTrigger(item) {
    // check for existing subscription
    let token;
    let subExists = false;
    let subscriptionArn;
    /* eslint-disable no-await-in-loop */
    do {
      const subsResponse = await aws.sns().listSubscriptionsByTopic({
        TopicArn: item.rule.value,
        NextToken: token
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
        ReturnSubscriptionArn: true
      };
      const r = await aws.sns().subscribe(subscriptionParams).promise();
      subscriptionArn = r.SubscriptionArn;
    }
    // create permission to invoke lambda
    const permissionParams = {
      Action: 'lambda:InvokeFunction',
      FunctionName: process.env.messageConsumer,
      Principal: 'sns.amazonaws.com',
      SourceArn: item.rule.value,
      StatementId: `${item.name}Permission`
    };
    await aws.lambda().addPermission(permissionParams).promise();
    return subscriptionArn;
  }

  async deleteSnsTrigger(item) {
    // delete permission statement
    const permissionParams = {
      FunctionName: process.env.messageConsumer,
      StatementId: `${item.name}Permission`
    };
    await aws.lambda().removePermission(permissionParams).promise();
    // delete sns subscription
    const subscriptionParams = {
      SubscriptionArn: item.rule.arn
    };
    return aws.sns().unsubscribe(subscriptionParams).promise();
  }

  /**
   * validate and update sqs rule with queue property
   *
   * @param {Object} rule the sqs rule
   * @returns {Object} the updated sqs rule
   */
  async validateAndUpdateSqsRule(rule) {
    const queueUrl = rule.rule.value;
    if (!(await aws.sqsQueueExists(queueUrl))) {
      throw new Error(`SQS queue ${queueUrl} does not exist or your account does not have permissions to access it`);
    }

    const qAttrParams = {
      QueueUrl: queueUrl,
      AttributeNames: ['All']
    };
    const attributes = await aws.sqs().getQueueAttributes(qAttrParams).promise();
    if (!attributes.Attributes.RedrivePolicy) {
      throw new Error(`SQS queue ${rule} does not have a dead-letter queue configured`);
    }

    // update rule meta
    if (!get(rule, 'meta.visibilityTimeout')) {
      set(rule, 'meta.visibilityTimeout', parseInt(attributes.Attributes.VisibilityTimeout, 10));
    }

    if (!get(rule, 'meta.retries')) set(rule, 'meta.retries', 3);
    return rule;
  }

  /**
   * get all rules with specified type and state
   *
   * @param {string} type - rule type
   * @param {string} state - rule state
   * @returns {Promise<Object>}
   */
  async getRulesByTypeAndState(type, state) {
    const scanResult = await this.scan({
      names: {
        '#st': 'state',
        '#rl': 'rule',
        '#tp': 'type'
      },
      filter: '#st = :enabledState AND #rl.#tp = :ruleType',
      values: {
        ':enabledState': state,
        ':ruleType': type
      }
    });

    return scanResult.Items;
  }
}

module.exports = Rule;

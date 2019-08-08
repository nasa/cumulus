/* eslint no-param-reassign: "off" */

'use strict';

const get = require('lodash.get');
const { invoke, Events } = require('@cumulus/ingest/aws');
const aws = require('@cumulus/common/aws');
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
    default:
      break;
    }
    return super.delete({ name: item.name });
  }

  setRuleState(ruleItem, state) {
    return {
      ...ruleItem,
      state
    };
  }

  setRuleValue(ruleItem, type, value) {
    return {
      ...ruleItem,
      rule: {
        ...ruleItem.rule,
        type,
        value
      }
    };
  }

  setKinesisRuleArns(ruleItem, ruleArns) {
    return {
      ...ruleItem,
      rule: {
        ...ruleItem.rule,
        arn: ruleArns.arn,
        logEventArn: ruleArns.logEventArn
      }
    };
  }

  setSnsRuleArn(ruleItem, snsSubscriptionArn) {
    const rule = {
      type: ruleItem.rule.type,
      value: ruleItem.rule.value
    };
    if (snsSubscriptionArn) {
      rule.arn = snsSubscriptionArn;
    }
    return {
      ...ruleItem,
      rule
    };
  }

  /**
   * Update a rule item
   *
   * @param {Object} original - the original rule
   * @param {Object} updates - key/value fields for update, may not be a complete rule item
   * @returns {Promise} the response from database updates
   */
  async update(original, updates) {
    // Make a copy of the existing rule to preserve existing values
    let updatedRule = {
      ...original,
      rule: {
        ...original.rule
      }
    };

    const stateChanged = (updates.state && updates.state !== original.state);
    if (stateChanged) {
      updatedRule = this.setRuleState(updatedRule, updates.state);
    }

    const valueUpdated = (updates.rule && updates.rule.value);
    if (valueUpdated) {
      updatedRule = this.setRuleValue(updatedRule, updatedRule.rule.type, updates.rule.value);
    }

    switch (updatedRule.rule.type) {
    case 'scheduled': {
      const payload = await Rule.buildPayload(updatedRule);
      await this.addRule(updatedRule, payload);
      break;
    }
    case 'kinesis':
      if (valueUpdated) {
        await this.deleteKinesisEventSources(updatedRule);
        const updatedRuleArns = await this.addKinesisEventSources(updatedRule);
        updatedRule = this.setKinesisRuleArns(updatedRule, updatedRuleArns);
      }
      break;
    case 'sns': {
      if (valueUpdated || stateChanged) {
        if (updatedRule.rule.arn) {
          await this.deleteSnsTrigger(updatedRule);
          updatedRule = this.setSnsRuleArn(updatedRule);
        }
        if (updatedRule.state === 'ENABLED') {
          const snsSubscriptionArn = await this.addSnsTrigger(updatedRule);
          updatedRule = this.setSnsRuleArn(updatedRule, snsSubscriptionArn);
        }
      }
      break;
    }
    default:
      break;
    }

    return super.update({ name: original.name }, updatedRule);
  }

  static async buildPayload(item) {
    // makes sure the workflow exists
    const bucket = process.env.system_bucket;
    const key = `${process.env.stackName}/workflows/${item.workflow}.json`;
    const exists = await aws.fileExists(bucket, key);

    if (!exists) throw new Error(`Workflow doesn\'t exist: s3://${bucket}/${key} for ${item.name}`);

    const template = `s3://${bucket}/${key}`;
    return {
      template,
      provider: item.provider,
      collection: item.collection,
      meta: get(item, 'meta', {}),
      cumulus_meta: get(item, 'cumulus_meta', {}),
      payload: get(item, 'payload', {}),
      queueName: item.queueName
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
    let newRule = {
      ...item
    };

    // the default state is 'ENABLED'
    if (!item.state) {
      item.state = 'ENABLED';
      newRule = this.setRuleState(newRule, 'ENABLED');
    }

    const payload = await Rule.buildPayload(newRule);
    switch (newRule.rule.type) {
    case 'onetime': {
      await invoke(process.env.invoke, payload);
      break;
    }
    case 'scheduled': {
      await this.addRule(newRule, payload);
      break;
    }
    case 'kinesis': {
      const ruleArns = await this.addKinesisEventSources(newRule);
      newRule = this.setKinesisRuleArns(newRule, ruleArns);
      break;
    }
    case 'sns': {
      if (newRule.state === 'ENABLED') {
        const snsSubscriptionArn = await this.addSnsTrigger(newRule);
        newRule = this.setSnsRuleArn(newRule, snsSubscriptionArn);
      }
      break;
    }
    default:
      throw new Error('Type not supported');
    }

    // save
    return super.create(newRule);
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
    const eventDelete = await Promise.all(deleteEventPromises);
    item.rule.arn = eventDelete[0];
    item.rule.logEventArn = eventDelete[1];
    return item;
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
    await aws.sns().unsubscribe(subscriptionParams).promise();

    return item;
  }
}

module.exports = Rule;

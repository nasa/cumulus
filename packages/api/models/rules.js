/* eslint no-param-reassign: "off" */

'use strict';

const get = require('lodash.get');
const { invoke, Events } = require('@cumulus/ingest/aws');
const aws = require('@cumulus/common/aws');
const Manager = require('./base');
const { rule } = require('./schemas');

class Rule extends Manager {
  constructor() {
    super({
      tableName: process.env.RulesTable,
      tableHash: { name: 'name', type: 'S' },
      schema: rule
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

  /**
   * update a rule item
   *
   * @param {*} original - the original rule
   * @param {*} updated - key/value fields for update, may not be a complete rule item
   * @returns {Promise} the response from database updates
   */
  async update(original, updated) {
    let stateChanged = false;
    if (updated.state && updated.state !== original.state) {
      original.state = updated.state;
      stateChanged = true;
    }

    let valueUpdated = false;
    if (updated.rule && updated.rule.value) {
      original.rule.value = updated.rule.value;
      if (updated.rule.type === undefined) updated.rule.type = original.rule.type;
      valueUpdated = true;
    }

    switch (original.rule.type) {
    case 'scheduled': {
      const payload = await Rule.buildPayload(original);
      await this.addRule(original, payload);
      break;
    }
    case 'kinesis':
      if (valueUpdated) {
        await this.deleteKinesisEventSources(original);
        await this.addKinesisEventSources(original);
        updated.rule.arn = original.rule.arn;
      } else {
        await this.updateKinesisEventSources(original);
      }
      break;
    case 'sns': {
      if (valueUpdated || stateChanged) {
        if (original.rule.arn) {
          await this.deleteSnsTrigger(original);
          if (!updated.rule) updated.rule = original.rule;
          delete updated.rule.arn;
        }
        if (original.state === 'ENABLED') {
          await this.addSnsTrigger(original);
          if (!updated.rule) updated.rule = original.rule;
          else updated.rule.arn = original.rule.arn;
        }
      }
      break;
    }
    default:
      break;
    }

    return super.update({ name: original.name }, updated);
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
      payload: get(item, 'payload', {})
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

    // the default state is 'ENABLED'
    if (!item.state) item.state = 'ENABLED';

    const payload = await Rule.buildPayload(item);
    switch (item.rule.type) {
    case 'onetime': {
      await invoke(process.env.invoke, payload);
      break;
    }
    case 'scheduled': {
      await this.addRule(item, payload);
      break;
    }
    case 'kinesis': {
      await this.addKinesisEventSources(item);
      break;
    }
    case 'sns': {
      if (item.state === 'ENABLED') {
        await this.addSnsTrigger(item);
      }
      break;
    }
    default:
      throw new Error('Type not supported');
    }

    // save
    return super.create(item);
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
    item.rule.arn = eventAdd[0].UUID;
    item.rule.logEventArn = eventAdd[1].UUID;
    return item;
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
    // create event source mapping
    const params = {
      EventSourceArn: item.rule.value,
      FunctionName: lambda.name,
      StartingPosition: 'TRIM_HORIZON',
      Enabled: item.state === 'ENABLED'
    };
    const data = await aws.lambda().createEventSourceMapping(params).promise();
    return data;
  }

  /**
   * Update event sources for all mappings in the kinesisSourceEvents
   * @param {*} item - the rule item
   * @returns {Promise<Array>} array of responses from the event source update
   */
  async updateKinesisEventSources(item) {
    const updateEvent = this.kinesisSourceEvents.map(
      (lambda) => this.updateKinesisEventSource(item, lambda.eventType)
    );
    return Promise.all(updateEvent);
  }

  /**
   * update an event source, only the state can be updated
   *
   * @param {Object} item - the rule item
   * @param {string} eventType - kinesisSourceEvent Type
   * @returns {Promise} the response from event source update
   */
  updateKinesisEventSource(item, eventType) {
    const params = {
      UUID: item.rule[this.eventMapping[eventType]],
      Enabled: item.state === 'ENABLED'
    };
    return aws.lambda().updateEventSourceMapping(params).promise();
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
    const params = {
      UUID: item.rule[this.eventMapping[eventType]]
    };
    return aws.lambda().deleteEventSourceMapping(params).promise();
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

    item.rule.arn = subscriptionArn;
    return item;
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

/* eslint-disable no-param-reassign */
'use strict';

const get = require('lodash.get');
const { invoke, Events } = require('@cumulus/ingest/aws');
const aws = require('@cumulus/common/aws');
const Manager = require('./base');
const { rule } = require('./schemas');

class Rule extends Manager {
  constructor() {
    super(process.env.RulesTable, rule);
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
    case 'kinesis':
      await this.deleteKinesisEventSource(item);
      break;
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
    if (updated.state) {
      original.state = updated.state;
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
        await this.deleteKinesisEventSource(original);
        await this.addKinesisEventSource(original);
        updated.rule.arn = original.rule.arn;
      }
      else {
        await this.updateKinesisEventSource(original);
      }
      break;
    default:
      break;
    }

    return super.update({ name: original.name }, updated);
  }

  static async buildPayload(item) {
    // makes sure the workflow exists
    const bucket = process.env.bucket;
    const key = `${process.env.stackName}/workflows/${item.workflow}.json`;
    const exists = await aws.fileExists(bucket, key);

    if (!exists) {
      const err = {
        message: 'Workflow doesn\'t exist'
      };
      throw err;
    }

    const template = `s3://${bucket}/${key}`;
    return {
      template,
      provider: item.provider,
      collection: item.collection,
      meta: get(item, 'meta', {}),
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
      const err = {
        message: 'Only word characters such as alphabets, numbers and underscore is allowed in name'
      };
      throw err;
    }

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
    case 'kinesis':
      await this.addKinesisEventSource(item);
      break;
    default:
      throw new Error('Type not supported');
    }

    // save
    return await super.create(item);
  }

  /**
   * add an event source to the kinesis consumer lambda function
   *
   * @param {*} item - the rule item
   * @returns {Promise} a promise
   * @returns {Promise} updated rule item
   */
  async addKinesisEventSource(item) {
    // use the existing event source mapping if it already exists
    const listParams = { FunctionName: process.env.kinesisConsumer };
    const listData = await aws.lambda(listParams).listEventSourceMappings().promise();
    if (listData.EventSourceMappings && listData.EventSourceMappings.length > 0) {
      const mappingExists = listData.EventSourceMappings
        .find((mapping) => { // eslint-disable-line arrow-body-style
          return (mapping.EventSourceArn === item.rule.value);
        });
      if (mappingExists) {
        item.rule.arn = mappingExists.UUID;
        return item;
      }
    }

    // create event source mapping
    const params = {
      EventSourceArn: item.rule.value,
      FunctionName: process.env.kinesisConsumer,
      StartingPosition: 'LATEST',
      Enabled: item.state === 'ENABLED'
    };

    const data = await aws.lambda().createEventSourceMapping(params).promise();
    item.rule.arn = data.UUID;
    return item;
  }

  /**
   * update an event source, only the state can be updated
   *
   * @param {*} item - the rule item
   * @returns {Promise} the response from event source update
   */
  async updateKinesisEventSource(item) {
    const params = {
      UUID: item.rule.arn,
      Enabled: item.state === 'ENABLED'
    };
    return await aws.lambda().updateEventSourceMapping(params).promise();
  }

  /**
   * deletes an event source from the kinesis consumer lambda function
   *
   * @param {*} item - the rule item
   * @returns {Promise} the response from event source delete
   */
  async deleteKinesisEventSource(item) {
    if (await this.isEventSourceMappingShared(item)) {
      return undefined;
    }

    const params = {
      UUID: item.rule.arn
    };
    return await aws.lambda().deleteEventSourceMapping(params).promise();
  }

  /**
   * check if a rule's event source mapping is shared with other rules
   *
   * @param {Object} item - the rule item
   * @returns {boolean} return true if no other rules share the same event source mapping
   */
  async isEventSourceMappingShared(item) {
    const kinesisRules = await super.scan({
      names: {
        '#nm': 'name',
        '#rl': 'rule',
        '#tp': 'type',
        '#arn': 'arn'
      },
      filter: '#nm <> :name AND #rl.#tp = :ruleType AND #rl.#arn = :arn',
      values: {
        ':name': item.name,
        ':ruleType': item.rule.type,
        ':arn': item.rule.arn
      }
    });

    return (kinesisRules.Count && kinesisRules.Count > 0);
  }

}

module.exports = Rule;

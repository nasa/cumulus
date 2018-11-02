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

    this.eventMapping = {event_arn: 'event_arn', log_event_arn: 'log_event_arn'};
    this.kinesisSourceEvents = [{name: process.env.kinesisConsumer, type: 'event_arn'},
                                {name: process.env.KinesisRuleInput, type: 'log_event_arn'}];
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
      await this.deleteKinesisEventSources(item);
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
        await this.deleteKinesisEventSources(original);
        await this.addKinesisEventSources(original);
        updated.rule.arn = original.rule.arn;
      }
      else {
        await this.updateKinesisEventSources(original);
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

    if (!exists) throw new Error(`Workflow doesn\'t exist: s3://${bucket}/${key} for ${item.name}`);

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
    case 'kinesis':
      await this.addKinesisEventSources(item);
      break;
    default:
      throw new Error('Type not supported');
    }

    // save
    return super.create(item);
  }

  async addKinesisEventSources(item) {
    const sourceEventPromises = this.kinesisSourceEvents.forEach((lambda) => {
      self.addKinesisEventSources(item, lambda);
    });
    //TODO: Add this back into addKinesisEventSource or remove magic array index
    const eventAdd = await Promise.all(sourceEventPromises);
    item.rule.event_arn = eventAdd[0];
    item.rule.log_event_arn = eventAdd[1];
    return item;
  }


  /**
   * add an event source to a target lambda function
   *
   * @param {*} item - the rule item
   * @param {String} lambda - the name of the target lambda
   * @returns {Promise} a promise
   * @returns {Promise} updated rule item
   */
  async addKinesisEventSource(item, lambda) {
    // TODO: Rename this function
    // use the existing event source mapping if it already exists and is enabled
    const listParams = { FunctionName: lambda.name };
    const listData = await aws.lambda(listParams).listEventSourceMappings().promise();
    if (listData.EventSourceMappings && listData.EventSourceMappings.length > 0) {
      const mappingExists = listData.EventSourceMappings
        .find((mapping) => { // eslint-disable-line arrow-body-style
          return (mapping.EventSourceArn === item.rule.value);
        });
      if (mappingExists) {
        if (mappingExists.State === 'Enabled') {
          return mappingExists;
        }
        await this.deleteKinesisEventSource({
          name: item.name,
          rule: {
            arn: mappingExists.UUID,
            type: 'kinesis'
          }
        }, lambda.type);
      }
    }

    // create event source mapping
    const params = {
      EventSourceArn: item.rule.value,
      FunctionName: lambda,
      StartingPosition: 'TRIM_HORIZON',
      Enabled: item.state === 'ENABLED'
    };

    const data = await aws.lambda().createEventSourceMapping(params).promise();

    return data;
  }

  async updateKinesisEventSources(item) {
    const updateEvent = this.kinesisSourceEvents.map((lambda) => {
      self.updateKinesisEventSource(item, lambda.type);
    });
    return Promise.all(updateEvent);
  }

  /**
   * update an event source, only the state can be updated
   *
   * @param {*} item - the rule item
   * @returns {Promise} the response from event source update
   */
  updateKinesisEventSource(item, eventType) {
    const params = {
      UUID: item.rule[this.eventMapping[eventType]],
      Enabled: item.state === 'ENABLED'
    };
    return aws.lambda().updateEventSourceMapping(params).promise();
  }


  async delteKinesisEventSources(item) {
    const deleteEventPromises = this.kinesisSourceEvents.forEach((lambda) => {
      self.deleteKinesisEventSource(item, lambda.eventType);
    });
    const eventDelete = await Promise.all(deleteEventPromises);
    //TODOD Remove magic array number
    item.rule.event_arn = eventDelete[0];
    item.rule.log_event_arn = eventDelete[1];
    return item;
  }

  /**
   * deletes an event source from the kinesis consumer lambda function
   *
   * @param {*} item - the rule item
   * @returns {Promise} the response from event source delete
   */
  async deleteKinesisEventSource(item, eventType) {
    if (await this.isEventSourceMappingShared(item, eventType)) {
      //TODO - what, why isn't this a promise resolved or warning or ... ?
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
   * @returns {boolean} return true if no other rules share the same event source mapping
   */
  async isEventSourceMappingShared(item, eventType) {
    const arnClause = `#rl.#${this.eventMapping[eventType]} = :${this.eventMapping[eventType]}`;
    const kinesisRules = await super.scan({
      names: {
        '#nm': 'name',
        '#rl': 'rule',
        '#tp': 'type',
        '#event_arn': 'event_arn',
        '#log_event_arn': 'log_event_arn'
      },

      fitler: '#nm <> :name AND #rl.#tp = :ruleType AND ' + arnClause,
      values: {
        ':name': item.name,
        ':ruleType': item.rule.type,
        ':event_arn': item.rule.event_arn,
        ':log_event_arn': item.rule.log_event_arn
      }
    });
    return (kinesisRules.Count && kinesisRules.Count > 0);
  }
}

module.exports = Rule;

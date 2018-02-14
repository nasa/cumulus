/* eslint-disable no-param-reassign */
'use strict';

const get = require('lodash.get');
const { S3, invoke, Events } = require('@cumulus/ingest/aws');
const aws = require('@cumulus/ingest/aws');
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
        this.deleteKinesisEventSource(item);
        break;
      default:
        throw new Error('Type not supported');
    }
    return super.delete({ name: item.name });
  }

  async update(original, updated) {
    if (updated.state) {
      original.state = updated.state;
    }

    let valueUpdated = false;
    if (updated.rule && updated.rule.value) {
      original.rule.value = updated.rule.value;
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
          this.deleteKinesisEventSource(original);
          this.addKinesisEventSource(original);
        }
        else this.updateKinesisEventSource(original);
        break;
      default:
        throw new Error('Type not supported');
    }

    return super.update({ name: original.name }, updated);
  }

  static async buildPayload(item) {
    // makes sure the workflow exists
    const bucket = process.env.bucket;
    const key = `${process.env.stackName}/workflows/${item.workflow}.json`;
    const exists = S3.fileExists(bucket, key);

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
      case 'onetime':
        await invoke(process.env.invoke, payload);
        break;
      case 'scheduled':
        await this.addRule(item, payload);
        break;
      case 'kinesis':
        await this.addKinesisEventSource(item);
        break;
      default:
        throw new Error('Type not supported');
    }

    // save
    return super.create(item);
  }

  /**
   * add an event source to the kinesis consumer lambda function
   *
   * @param {*} item - the rule item
   * @returns {Promise} a promise
   */
  async addKinesisEventSource(item) {
    const params = {
      EventSourceArn: item.rule.value,
      FunctionName: process.env.kinesisConsumer,
      StartingPosition: LATEST, // eslint-disable-line no-undef
      Enabled: item.state
    };
    return await aws.lambda.createEventSourceMapping(params).promise()
      .then((data) => {
        item.rule.arn = data.UUID;
      });
  }

  /**
   * update an event source, only the state can be updated
   *
   * @param {*} item - the rule item
   * @returns {Promise} a promise
   */
  async updateKinesisEventSource(item) {
    const params = {
      UUID: item.rule.arn,
      Enabled: item.state
    };
    return await aws.lambda.updateEventSourceMapping(params).promise();
  }

  /**
   * delete an event source the from kinesis consumer lambda function
   *
   * @param {*} item - the rule item
   * @returns {Promise} a promise
   */
  async deleteKinesisEventSource(item) {
    const params = {
      UUID: item.rule.arn
    };
    return await aws.lambda.deleteEventSourceMapping(params).promise();
  }

}

module.exports = Rule;

/* eslint-disable no-param-reassign */
'use strict';

const get = require('lodash.get');
const { S3, invoke, Events } = require('@cumulus/ingest/aws');
const Manager = require('./base');
const Provider = require('./providers');
const Collection = require('./collections');
const { rule } = require('./schemas');

class Rule extends Manager {
  constructor() {
    super(process.env.RulesTable, rule);
    this.targetId = 'lambdaTarget';
  }

  async addRule(item, payload) {
    const name = `${process.env.stackName}-${process.env.stage}-custom-${item.name}`;
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
    if (item.rule.type === 'scheduled') {
      const name = `${process.env.stackName}-${process.env.stage}-custom-${item.name}`;
      await Events.deleteTarget(this.targetId, name);
      await Events.deleteEvent(name);
    }
    return super.delete({ name: item.name });
  }

  async update(original, updated) {
    if (updated.state) {
      original.state = updated.state;
    }

    if (updated.rule && updated.rule.value) {
      original.rule.value = updated.rule.value;
    }

    const payload = await Rule.buildPayload(original);
    await this.addRule(original, payload);

    return super.update({ name: original.name }, updated);
  }

  static async buildPayload(item) {
    // make sure collection exists
    const c = new Collection();
    const collection = await c.get({
      name: item.collection.name,
      version: item.collection.version
    });

    let provider = {};
    // make sure provider exists
    if (item.provider) {
      const p = new Provider();
      provider = await p.get({ id: item.provider });
    }

    // makes sure the workflow exists
    const bucket = process.env.bucket;
    const key = `${process.env.stackName}-${process.env.stage}/workflows/${item.workflow}.json`;
    const exists = S3.fileExists(bucket, key);

    if (!exists) {
      const err = {
        message: 'Woflow doesn\'t exist'
      };
      throw err;
    }

    const template = `s3://${bucket}/${key}`;
    return {
      template,
      provider,
      collection,
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
      default:
        throw new Error('Type not supported');
    }

    // if recurring set the cloudwatch rule

    // TODO: implement subscription

    // if onetime and enabled launch lambda function


    // save
    return super.create(item);
  }
}

module.exports = Rule;

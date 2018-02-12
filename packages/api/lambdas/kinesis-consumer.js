/* eslint-disable require-yield */
'use strict';
const ajv = new require('ajv')();

const manager = require('../models/base');
const Rule = require('../models/rules');
const model = new Rule();
model.tableName = 'rule';
const messageSchema = require('./kinesis-consumer-event-schema.json');

async function getRules(event) {
  const collection = event.collection;
  const subscriptionRules = await model.scan({
    filter: {
      type: 'subscription',
      collection: {
        name: collection
      },
      state: 'ENABLED'
    }
  });

  return subscriptionRules.Items;
}

async function createOneTimeRules(subscriptionRules) {
  const oneTimeRulePromises = subscriptionRules.map((subscriptionRule) => {
    const oneTimeRuleParams = Object.assign({}, subscriptionRule);
    delete oneTimeRuleParams['createdAt'];
    delete oneTimeRuleParams['updatedAt'];
    oneTimeRuleParams.rule.type = 'onetime';
    return model.create(oneTimeRuleParams);
  });

  return await Promise.all(oneTimeRulePromises);
}

async function validateMessage(event) {
  const validate = ajv.compile(messageSchema);
  return await validate(event);
}

function handler(event, context, cb) {
  return event;
}

module.exports = {
  createOneTimeRules,
  getRules,
  handler,
  validateMessage
};

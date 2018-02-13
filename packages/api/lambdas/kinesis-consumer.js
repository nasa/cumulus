/* eslint-disable require-yield */
'use strict';
const ajv = new require('ajv')();

const manager = require('../models/base');
const Rule = require('../models/rules');
const model = new Rule();
const messageSchema = require('./kinesis-consumer-event-schema.json');

async function getSubscriptionRules(event) {
  const collection = event.collection;
  const subscriptionRules = await model.scan({
    names: {
      '#col': 'collection',
      '#nm': 'name',
      '#st': 'state',
      '#rl': 'rule',
      '#tp': 'type'
    },
    filter: '#st = :enabledState AND #col.#nm = :collectionName AND #rl.#tp = :ruleType',
    values: {
      ':enabledState': 'ENABLED',
      ':collectionName': collection,
      ':ruleType': 'subscription'
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

async function handler(event, context, cb) {
  return await getSubscriptionRules(event)
    .then((subscriptionRules) => {
      return createOneTimeRules(subscriptionRules);
    });
}

module.exports = {
  createOneTimeRules,
  getSubscriptionRules,
  handler,
  validateMessage
};

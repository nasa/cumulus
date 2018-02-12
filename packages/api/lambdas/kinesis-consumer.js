/* eslint-disable require-yield */
'use strict';

const manager = require('../models/base');
const models = require('../models');
const model = new models.Rule();
model.tableName = 'rule';

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

function handler(event, context, cb) {
  return event;
}

module.exports = {
  createOneTimeRules,
  getRules,
  handler
};

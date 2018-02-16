/* eslint-disable require-yield */
'use strict';
const Ajv = require('ajv');

const Rule = require('../models/rules');
const model = new Rule();
const messageSchema = require('./kinesis-consumer-event-schema.json');

/**
 * `getSubscriptionRules` scans and returns DynamoDB rules table for enabled, 'subscription'-type rules associated with the * collection declared in the event
 *
 * @param {object} event lambda event
 * @returnss {array} List of zero or more rules found from table scan
 */
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

/**
 * `createOneTimeRules` creates new rules with the same data as a subscription-type rule, except the type is modified to 'onetime'.
 *
 * @param {array} subscriptionRules list of rule objects
 * @returns {array} Array of promises for model.create
 */
async function createOneTimeRules(subscriptionRules) {
  const oneTimeRulePromises = subscriptionRules.map((subscriptionRule) => {
    const oneTimeRuleParams = Object.assign({}, subscriptionRule);
    delete oneTimeRuleParams['createdAt'];
    delete oneTimeRuleParams['updatedAt'];
    oneTimeRuleParams.name = `${subscriptionRule.name}_${Date.now().toString()}`;
    oneTimeRuleParams.rule.type = 'onetime';
    return model.create(oneTimeRuleParams);
  });

  return await Promise.all(oneTimeRulePromises);
}

/**
 * `validateMessage` validates an event as being valid for creating a workflow. See the messageSchema defined at
 * the top of this file.
 *
 * @param {object} event lambda event
 * @returns {(error|object)} Throws an Ajv.ValidationError if event object is invalid. Returns the event object if event is valid.
 */
async function validateMessage(event) {
  const ajv = new Ajv({allErrors: true});
  const validate = ajv.compile(messageSchema);
  return await validate(event);
}

async function processRecord(record) {
  const dataBlob = record.kinesis.data;
  const dataString = Buffer.from(dataBlob, 'base64').toString();
  const eventObject = JSON.parse(dataString);

  await validateMessage(eventObject)
    .then(getSubscriptionRules)
    .then((subscriptionRules) => {
      return createOneTimeRules(subscriptionRules);
    });
}

/**
 * `handler` Looks up enabled 'subsciption'-type rules associated with the collection in the event argument. It
 * creates new onetime rules for each rule found to trigger the workflow defined in the 'subscription'-type rule.
 *
 * @param {*} event lambda event
 * @param {*} context lambda context
 * @param {*} cb callback function to explicitly return information back to the caller.
 * @returns {(error|string)} Success message or error
 */
function handler(event, context, cb) {
  const records = event.Records;

  return Promise.all(records.map(r => processRecord(r)))
    .then((results) => cb(null, results.filter(r => r !== undefined)))
    .catch((err) => {
      cb(JSON.stringify(err));
    });
}

module.exports = {
  getSubscriptionRules,
  handler
};

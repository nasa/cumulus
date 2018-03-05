/* eslint-disable require-yield */
'use strict';
const Ajv = require('ajv');

const Rule = require('../models/rules');
const model = new Rule();
const messageSchema = require('./kinesis-consumer-event-schema.json');

/**
 * `getKinesisRules` scans and returns DynamoDB rules table for enabled,
 * 'kinesis'-type rules associated with the * collection declared in the event
 *
 * @param {Object} event - lambda event
 * @returns {Array} List of zero or more rules found from table scan
 */
async function getKinesisRules(event) {
  const collection = event.collection;
  const kinesisRules = await model.scan({
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
      ':ruleType': 'kinesis'
    }
  });

  return kinesisRules.Items;
}

/**
 * `createOneTimeRules` creates new rules with the same data as a kinesis-type rule,
 * except the type is modified to 'onetime'.
 *
 * @param {Array} kinesisRules - list of rule objects
 * @param {Object} eventObject - kinesis message input
 * @returns {Array} Array of promises for model.create
 */
async function createOneTimeRules(kinesisRules, eventObject) {
  const oneTimeRulePromises = kinesisRules.map((kinesisRule) => {
    const oneTimeRuleParams = Object.assign({}, kinesisRule);
    delete oneTimeRuleParams['createdAt'];
    delete oneTimeRuleParams['updatedAt'];
    oneTimeRuleParams.name = `${kinesisRule.name}_${Date.now().toString()}`;
    oneTimeRuleParams.rule.type = 'onetime';
    oneTimeRuleParams.payload = eventObject;
    return model.create(oneTimeRuleParams);
  });

  return await Promise.all(oneTimeRulePromises);
}

/**
 * `validateMessage` validates an event as being valid for creating a workflow.
 * See the messageSchema defined at the top of this file.
 *
 * @param {Object} event - lambda event
 * @returns {(error|Object)} Throws an Ajv.ValidationError if event object is invalid.
 * Returns the event object if event is valid.
 */
async function validateMessage(event) {
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(messageSchema);
  return await validate(event);
}

/**
 * Process data sent to a kinesis stream. Validate the data and
 * create rules.
 *
 * @param {*} record - input to the kinesis stream
 * @returns {Promise} promise
 */
async function processRecord(record) {
  const dataBlob = record.kinesis.data;
  const dataString = Buffer.from(dataBlob, 'base64').toString();
  const eventObject = JSON.parse(dataString);

  await validateMessage(eventObject)
    .then(getKinesisRules)
    .then((kinesisRules) => {
      return createOneTimeRules(kinesisRules, eventObject);
    });
}

/**
 * `handler` Looks up enabled 'kinesis'-type rules associated with the collection
 * in the event argument. It creates new onetime rules for each rule found to trigger
 * the workflow defined in the 'kinesis'-type rule.
 *
 * @param {*} event - lambda event
 * @param {*} context - lambda context
 * @param {*} cb - callback function to explicitly return information back to the caller.
 * @returns {(error|string)} Success message or error
 */
function handler(event, context, cb) {
  const records = event.Records;

  return Promise.all(records.map((r) => processRecord(r)))
    .then((results) => cb(null, results.filter((r) => r !== undefined)))
    .catch((err) => {
      cb(JSON.stringify(err));
    });
}

module.exports = {
  getKinesisRules,
  handler
};

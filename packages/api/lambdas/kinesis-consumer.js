/* eslint-disable require-yield */

'use strict';

const Ajv = require('ajv');

const log = require('@cumulus/common/log');
const Rule = require('../models/rules');
const messageSchema = require('./kinesis-consumer-event-schema.json');
const sfSchedule = require('./sf-scheduler');

/**
 * `getKinesisRules` scans and returns DynamoDB rules table for enabled,
 * 'kinesis'-type rules associated with the * collection declared in the event
 *
 * @param {Object} event - lambda event
 * @returns {Array} List of zero or more rules found from table scan
 */
async function getKinesisRules(event) {
  const { collection } = event;
  const model = new Rule();
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
 * Queue a workflow message for the kinesis rule with the message passed
 * to kinesis as the payload
 *
 * @param {Object} kinesisRule - kinesis rule to queue the message for
 * @param {Object} eventObject - message passed to kinesis
 * @returns {Promise} promise resolved when the message is queued
 */
async function queueMessageForRule(kinesisRule, eventObject) {
  const item = {
    workflow: kinesisRule.workflow,
    provider: kinesisRule.provider,
    collection: kinesisRule.collection,
    payload: eventObject
  };

  const payload = await Rule.buildPayload(item);
  return new Promise((resolve, reject) => sfSchedule(payload, {}, (err, result) => {
    if (err) reject(err);
    resolve(result);
  }));
}

/**
 * `validateMessage` validates an event as being valid for creating a workflow.
 * See the messageSchema defined at the top of this file.
 *
 * @param {Object} event - lambda event
 * @returns {(error|Object)} Throws an Ajv.ValidationError if event object is invalid.
 * Returns the event object if event is valid.
 */
function validateMessage(event) {
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(messageSchema);
  return validate(event);
}

/**
 * Process data sent to a kinesis stream. Validate the data and
 * queue a workflow message for each rule.
 *
 * @param {*} record - input to the kinesis stream
 * @returns {[Promises]} Array of promises. Each promise is resolved when a
 * message is queued for all associated kinesis rules.
 */
function processRecord(record) {
  const dataBlob = record.kinesis.data;
  const dataString = Buffer.from(dataBlob, 'base64').toString();
  const eventObject = JSON.parse(dataString);

  return validateMessage(eventObject)
    .then(getKinesisRules)
    .then((kinesisRules) => (
      Promise.all(kinesisRules.map((kinesisRule) => queueMessageForRule(kinesisRule, eventObject)))
    ))
    .catch((err) => {
      log.error('Caught error in process record:');
      log.error(err);
      return err;
    });
}

/**
 * `handler` Looks up enabled 'kinesis'-type rules associated with the collection
 * in the event argument. It enqueues a message for each kinesis-type rule to trigger
 * the associated workflow.
 *
 * @param {*} event - lambda event
 * @param {*} context - lambda context
 * @param {*} cb - callback function to explicitly return information back to the caller.
 * @returns {(error|string)} Success message or error
 */
function handler(event, context, cb) {
  const records = event.Records;

  return Promise.all(records.map(processRecord))
    .then((results) => cb(null, results.filter((r) => r !== undefined)))
    .catch((err) => {
      cb(JSON.stringify(err));
    });
}

module.exports = {
  getKinesisRules,
  handler
};

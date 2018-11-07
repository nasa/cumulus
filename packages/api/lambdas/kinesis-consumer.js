'use strict';

const Ajv = require('ajv');
const {
  aws: { sns },
  log
} = require('@cumulus/common');
const Rule = require('../models/rules');
const messageSchema = require('./kinesis-consumer-event-schema.json');
const { queueMessageForRule } = require('../lib/rulesHelpers');

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
 * `getSnsRules` scans and returns DynamoDB rules table for enabled,
 * 'sns'-type rules associated with the * collection declared in the event
 *
 * @param {Object} event - lambda event
 * @returns {Array} List of zero or more rules found from table scan
 */
async function getSnsRules(event) {
  const { topicArn } = event;
  const model = new Rule();
  const snsRules = await model.scan({
    names: {
      '#st': 'state',
      '#rl': 'rule',
      '#tp': 'type',
      '#vl': 'value'
    },
    filter: '#st = :enabledState AND #rl.#tp = :ruleType AND #rl.#vl = :ruleValue',
    values: {
      ':enabledState': 'ENABLED',
      ':ruleType': 'sns',
      ':ruleValue': topicArn
    }
  });

  return snsRules.Items;
}

async function getRules(event, originalMessageSource) {
  if (originalMessageSource === 'kinesis') {
    return getKinesisRules(event);
  }
  if (originalMessageSource === 'sns') {
    return getSnsRules(event);
  }
  throw new Error('Unrecognized event source');
}

/**
 * `validateMessage` validates an event as being valid for creating a workflow.
 * See the messageSchema defined at the top of this file.
 *
 * @param {Object} event - lambda event
 * @param {string} originalMessageSource - 'kinesis' or 'sns'
 * @returns {(error|Object)} Throws an Ajv.ValidationError if event object is invalid.
 * Returns the event object if event is valid.
 */
function validateMessage(event, originalMessageSource) {
  if (originalMessageSource === 'sns') return Promise.resolve(event);

  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(messageSchema);
  return validate(event);
}


/**
 * Publish a record to the fallback SNS topic for further processing.
 *
 * @param {Object} record - errored record
 * @returns {Promise<Object>} - SNS publish response
 */
async function publishRecordToFallbackTopic(record) {
  const fallbackArn = process.env.FallbackTopicArn;
  log.info('publishing bad kinesis record to Topic:', fallbackArn);
  log.info('record:', JSON.stringify(record));
  return sns().publish({
    TopicArn: fallbackArn,
    Message: JSON.stringify(record)
  }).promise();
}


/**
 * processRecord error handler.  If the error comes on first attempt then publish the failure
 * to the fallback SNS topic. If the message is already a fallback message, throw an error.
 *
 * @param {Error} error - error raised in processRecord.
 * @param {Object} record - record processed during error event.
 * @param {Bool} isKinesisRetry - flag to determine if the error should be sent
 *   for further processing or just raised to be handled by the
 *   lambda. isKinesisRetry is false if the record being processes is directly from
 *   Kinesis.
 * @returns {(res|error)} - result of publishing to topic, or original error if publish fails.
 * @throws {Error} - throws the original error if no special handling requested.
 */
function handleProcessRecordError(error, record, isKinesisRetry) {
  if (!isKinesisRetry) {
    return publishRecordToFallbackTopic(record)
      .then((res) => {
        log.debug('sns result:', res);
        return res;
      })
      .catch((snsError) => {
        // We couldn't publish the record to the fallback Topic, so we will log
        // and throw the original error.  Kinesis polling will pick up this
        // record again and retry.
        log.error(`Failed to publish record to fallback topic: ${record}`);
        log.error(`original error: ${error}`);
        log.error(`subsequent error: ${snsError}`);
        throw error;
      });
  }
  throw error;
}

/**
 * Process data sent to a kinesis stream. Validate the data and
 * queue a workflow message for each rule.
 *
 * @param {*} record - input to the kinesis stream
 * @param {Bool} fromSNS - flag specifying if this is event is from SNS.  SNS
 *        events come from the fallback SNS Topic and are retries of original
 *        Kinesis events.  If this flag is true, errors are raised normally.
 *        If false, the record is from a Kinesis stream and any errors
 *        encountered will cause the record to be published to a fallback SNS
 *        topic for further attempts at processing.
 * @returns {[Promises]} Array of promises. Each promise is resolved when a
 * message is queued for all associated kinesis rules.
 */
function processRecord(record, fromSNS) {
  let eventObject;
  let isKinesisRetry = false;
  let parsed;
  let originalMessageSource;

  if (fromSNS) {
    parsed = JSON.parse(record.Sns.Message);
  }
  if (fromSNS && !parsed.kinesis) {
    // normal SNS notification - not a Kinesis fallback
    eventObject = parsed.Records[0];
    originalMessageSource = 'sns';
    eventObject.topicArn = record.Sns.TopicArn;
  }
  else {
    // kinesis notification -  sns fallback or direct
    let dataBlob;
    if (fromSNS) {
      // Kinesis fallback SNS notification
      isKinesisRetry = true;
      dataBlob = parsed.kinesis.data;
    }
    else {
      dataBlob = record.kinesis.data;
    }
    try {
      const dataString = Buffer.from(dataBlob, 'base64').toString();
      eventObject = JSON.parse(dataString);
      originalMessageSource = 'kinesis';
    }
    catch (err) {
      log.error('Caught error parsing JSON:');
      log.error(err);
      return handleProcessRecordError(err, record, isKinesisRetry);
    }
  }

  return validateMessage(eventObject, originalMessageSource)
    .then((e) => getRules(e, originalMessageSource))
    .then((rules) => (
      Promise.all(rules.map((rule) => queueMessageForRule(rule, eventObject)))
    ))
    .catch((err) => {
      log.error('Caught error in processRecord:');
      log.error(err);
      return handleProcessRecordError(err, record, isKinesisRetry);
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
  const fromSns = event.Records[0].EventSource === 'aws:sns';
  const records = event.Records;

  return Promise.all(records.map((r) => processRecord(r, fromSns)))
    .then((results) => cb(null, results.filter((r) => r !== undefined)))
    .catch((err) => {
      cb(err);
    });
}

module.exports = {
  getRules,
  handler
};

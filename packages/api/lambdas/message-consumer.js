'use strict';

const Ajv = require('ajv');
const set = require('lodash.set');
const {
  aws: { sns },
  log
} = require('@cumulus/common');
const Rule = require('../models/rules');
const kinesisSchema = require('./kinesis-consumer-event-schema.json');
const { queueMessageForRule } = require('../lib/rulesHelpers');

/**
 * `getKinesisRules` scans and returns DynamoDB rules table for enabled,
 * 'kinesis'-type rules associated with the * collection declared in the event
 *
 * @param {Object} collection - lambda event
 * @returns {Array} List of zero or more rules found from table scan
 */
async function getKinesisRules(collection) {
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
 * @param {string} topicArn - sns topic arn
 * @returns {Array} List of zero or more rules found from table scan
 */
async function getSnsRules(topicArn) {
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

async function getRules(param, originalMessageSource) {
  if (originalMessageSource === 'kinesis') {
    return getKinesisRules(param);
  }
  if (originalMessageSource === 'sns') {
    return getSnsRules(param);
  }
  throw new Error('Unrecognized event source');
}

/**
 * `validateMessage` validates an event as being valid for creating a workflow.
 * See the schemas defined at the top of this file.
 *
 * @param {Object} event - lambda event
 * @param {string} originalMessageSource - 'kinesis' or 'sns'
 * @param {Object} messageSchema - provided messageSchema
 * @returns {(error|Object)} Throws an Ajv.ValidationError if event object is invalid.
 * Returns the event object if event is valid.
 */
function validateMessage(event, originalMessageSource, messageSchema) {
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
 * @param {Bool} fromSNS - whether message that caused error is from SNS (non-kinesis)
 * @param {Bool} isKinesisRetry - flag to determine if the error should be sent
 *   for further processing or just raised to be handled by the
 *   lambda. isKinesisRetry is false if the record being processes is directly from
 *   Kinesis.
 * @returns {(res|error)} - result of publishing to topic, or original error if publish fails.
 * @throws {Error} - throws the original error if no special handling requested.
 */
function handleProcessRecordError(error, record, fromSNS, isKinesisRetry) {
  if (!isKinesisRetry) {
    if (fromSNS) {
      log.error('Failed SNS message:');
      log.error(JSON.stringify(record));
      throw error;
    }
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
  let validationSchema;
  let originalMessageSource;
  let ruleParam;

  if (fromSNS) {
    parsed = JSON.parse(record.Sns.Message);
  }
  if (fromSNS && !parsed.kinesis) {
    // normal SNS notification - not a Kinesis fallback
    eventObject = parsed;
    originalMessageSource = 'sns';
    ruleParam = record.Sns.TopicArn;
  } else {
    // kinesis notification -  sns fallback or direct
    let dataBlob;
    if (fromSNS) {
      // Kinesis fallback SNS notification
      isKinesisRetry = true;
      dataBlob = parsed.kinesis.data;
    } else {
      dataBlob = record.kinesis.data;
    }
    try {
      validationSchema = kinesisSchema;
      originalMessageSource = 'kinesis';
      const dataString = Buffer.from(dataBlob, 'base64').toString();
      eventObject = JSON.parse(dataString);
      ruleParam = eventObject.collection;
    } catch (err) {
      log.error('Caught error parsing JSON:');
      log.error(err);
      if (fromSNS) {
        return handleProcessRecordError(err, record, isKinesisRetry, fromSNS);
      }
    }
  }

  return validateMessage(eventObject, originalMessageSource, validationSchema)
    .then(() => getRules(ruleParam, originalMessageSource))
    .then((rules) => (
      Promise.all(rules.map((rule) => {
        if (originalMessageSource === 'sns') set(rule, 'meta.snsSourceArn', ruleParam);
        return queueMessageForRule(rule, eventObject);
      }))))
    .catch((err) => {
      log.error('Caught error in processRecord:');
      log.error(err);
      return handleProcessRecordError(err, record, isKinesisRetry, fromSNS);
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

'use strict';

const Ajv = require('ajv');
const {
  aws: { sns },
  log
} = require('@cumulus/common');
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
    meta: kinesisRule.meta,
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
 * processRecord error handler.  If the error comes on first attempt
 *
 * @param {Error} error - error raised in processRecord.
 * @param {Object} record - record processed during error event.
 * @param {Bool} shouldRetry - flag to determine if the error should be sent
 *   for further processing or just raised to be handled by the
 *   lambda. shouldRetry is true if the record being processes is directly from
 *   Kinesis.
 * @returns {(res|error)} - result of publishing to topic, or original error if publish fails.
 * @throws {Error} - throws the original error if no special handling requested.
 */
function handleProcessRecordError(error, record, shouldRetry) {
  if (shouldRetry) {
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
  let dataBlob;
  if (fromSNS) {
    const parsed = JSON.parse(record.Sns.Message);
    dataBlob = parsed.kinesis.data;
  }
  else {
    dataBlob = record.kinesis.data;
  }
  const dataString = Buffer.from(dataBlob, 'base64').toString();

  try {
    eventObject = JSON.parse(dataString);
  }
  catch (err) {
    log.error('Caught error parsing JSON:');
    log.error(err);
    return handleProcessRecordError(err, record, !fromSNS);
  }

  return validateMessage(eventObject)
    .then(getKinesisRules)
    .then((kinesisRules) => (
      Promise.all(kinesisRules.map((kinesisRule) => queueMessageForRule(kinesisRule, eventObject)))
    ))
    .catch((err) => {
      log.error('Caught error in processRecord:');
      log.error(err);
      return handleProcessRecordError(err, record, !fromSNS);
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
  const fallbackRetry = event.Records[0].EventSource === 'aws:sns';
  const records = event.Records;

  return Promise.all(records.map((r) => processRecord(r, fallbackRetry)))
    .then((results) => cb(null, results.filter((r) => r !== undefined)))
    .catch((err) => {
      cb(err);
    });
}

module.exports = {
  getKinesisRules,
  handler
};

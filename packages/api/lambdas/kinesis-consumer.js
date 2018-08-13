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
 * `getSnsRules` scans and returns DynamoDB rules table for enabled,
 * 'sns'-type rules associated with the * collection declared in the event
 *
 * @param {Object} event - lambda event
 * @returns {Array} List of zero or more rules found from table scan
 */
async function getSnsRules(event) {
  console.log('SNS event:')
  console.log(JSON.stringify(event, null, 2));
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
    return await getKinesisRules(event);
  } else if (originalMessageSource === 'sns') {
    return await getSnsRules(event);
  } else {
    throw new Error('Unrecognized event source');
  }
}

/**
 * `validateMessage` validates an event as being valid for creating a workflow.
 * See the messageSchema defined at the top of this file.
 *
 * @param {Object} event - lambda event
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
 * processRecord error handler.  If the error comes on first attempt
 *
 * @param {Error} error - error raised in processRecord.
 * @param {Object} record - record processed during error event.
 * @param {Bool} kinesisRetry - flag to determine if the error should be sent
 *   for further processing or just raised to be handled by the
 *   lambda. kinesisRetry is true if the record being processes is directly from
 *   Kinesis.
 * @returns {(res|error)} - result of publishing to topic, or original error if publish fails.
 * @throws {Error} - throws the original error if no special handling requested.
 */
function handleProcessRecordError(error, record, kinesisRetry) {
  if (kinesisRetry) {
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
  let dataString;
  let kinesisRetry = false;
  let parsed;
  let originalMessageSource;

  if (fromSNS) {
    parsed = JSON.parse(record.Sns.Message);
  }

  if (fromSNS && !parsed.kinesis) {
    // normal SNS notification - not a fallback
    eventObject = parsed.Records[0];
    originalMessageSource = 'sns';
    eventObject.topicArn = record.Sns.TopicArn;
  }
  else {
    // fallback SNS notification
    if (fromSNS) {
      kinesisRetry = true;
      dataBlob = parsed.kinesis.data;
    }
    else {
      dataBlob = record.kinesis.data;
    };

    dataString = Buffer.from(dataBlob, 'base64').toString();
    try {
      eventObject = JSON.parse(dataString);
      originalMessageSource = 'kinesis';
    }
    catch (err) {
      log.error('Caught error parsing JSON:');
      log.error(err);
      return handleProcessRecordError(err, record, !kinesisRetry);
    }
  }

  return validateMessage(eventObject, originalMessageSource)
    .then(e => getRules(e, originalMessageSource))
    .then((rules) => (
      Promise.all(rules.map((rule) => queueMessageForRule(rule, eventObject)))
    ))
    .catch((err) => {
      log.error('Caught error in processRecord:');
      log.error(err);
      return handleProcessRecordError(err, record, !kinesisRetry);
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
  console.log(JSON.stringify(event, null, 2));
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

// process.env.RulesTable = 'gdelt-RulesTable'
// process.env.CollectionsTable = 'gdelt-CollectionsTable'
// process.env.ProvidersTable = 'gdelt-ProvidersTable'
// process.env.bucket = 'cumulus-developmentseed-internal'
// process.env.stackName = 'gdelt'

// const testEvent = {
//     "Records": [
//         {
//             "EventSource": "aws:sns",
//             "EventVersion": "1.0",
//             "EventSubscriptionArn": "arn:aws:sns:us-east-1:000000000000:gdelt-csv:7ecb1f8a-0be6-4824-8080-f3a2a1cc1bd4",
//             "Sns": {
//                 "Type": "Notification",
//                 "MessageId": "00381af2-596c-5bfe-ae48-4919b368b60b",
//                 "TopicArn": "arn:aws:sns:us-east-1:000000000000:gdelt-csv",
//                 "Subject": "Amazon S3 Notification",
//                 "Message": "{\"Records\":[{\"eventVersion\":\"2.0\",\"eventSource\":\"aws:s3\",\"awsRegion\":\"us-east-1\",\"eventTime\":\"2018-08-13T20:19:16.518Z\",\"eventName\":\"ObjectCreated:Put\",\"userIdentity\":{\"principalId\":\"AWS:AIDAJ7YZ3DBEEFCANJXS4\"},\"requestParameters\":{\"sourceIPAddress\":\"52.88.114.198\"},\"responseElements\":{\"x-amz-request-id\":\"9E978F149429AD5C\",\"x-amz-id-2\":\"eOuT32lDYaPgGH7KnsL0rteoZOQI1f9BJ4US0ZhYtURXAuGFa8P28vNKKfGazJNNzlgQXS7tgEQ=\"},\"s3\":{\"s3SchemaVersion\":\"1.0\",\"configurationId\":\"gdelt-csv\",\"bucket\":{\"name\":\"gdelt-open-data\",\"ownerIdentity\":{\"principalId\":\"A1U4SRL76U00CF\"},\"arn\":\"arn:aws:s3:::gdelt-open-data\"},\"object\":{\"key\":\"v2/gkg/20180813201500.gkg.csv\",\"size\":40653852,\"eTag\":\"94068ad1e32b31352258c6a344e8f006\",\"sequencer\":\"005B71E7C2EA42325B\"}}}]}",
//                 "Timestamp": "2018-08-13T20:19:16.563Z",
//                 "SignatureVersion": "1",
//                 "Signature": "BKqrVoDZi8lUW0hHj4OqR0LijLpYRLOgoeu13e1/h/CMLqLONTN69vp6yS8pytFkA+MVJuDIR47Nd+fury8no50V69lVxSoGoRAE0wTNfja0xUe3MGFC+XEvD5C18SXTl0NKnW42CnL3GoaG0EkxMXagpq7rl9Tz6ggq5SmDLS1heyxwXQi8ucJ7lavDfsvk479EaY3qR8SFYrMLI1Io/TNTxwBV7m7QAHf/wfH661bS9PsC1+XxQvnbpr/SFwB4zXZIZW2cBWAim8qTmxL09r2z8Px24dSE7NjG6K3kzSnFHHRcmRIHYesxk1k8JsIlpaEnYAVYeZ4NiYqcP194oQ==",
//                 "SigningCertUrl": "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-eaea6120e66ea12e88dcd8bcbddca752.pem",
//                 "UnsubscribeUrl": "https://sns.us-east-1.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=arn:aws:sns:us-east-1:000000000000:gdelt-csv:7ecb1f8a-0be6-4824-8080-f3a2a1cc1bd4",
//                 "MessageAttributes": {}
//             }
//         }
//     ]
// }

// handler(testEvent, {}, (err, result) => {
//   if (err) console.log(err);
//   console.log(result);
// });


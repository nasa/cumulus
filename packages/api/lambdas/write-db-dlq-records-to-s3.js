//@ts-check

'use strict';

const get = require('lodash/get');
const uuidv4 = require('uuid/v4');

const log = require('@cumulus/common/log');
const { isEventBridgeEvent } = require('@cumulus/common/lambda');
const { s3PutObject } = require('@cumulus/aws-client/S3');
const { parseSQSMessageBody } = require('@cumulus/aws-client/SQS');
const { unwrapDeadLetterCumulusMessage } = require('@cumulus/message/DeadLetterMessage');
const { getCumulusMessageFromExecutionEvent } = require('@cumulus/message/StepFunctions');
/**
 *
 * @typedef {import('@cumulus/types/message').CumulusMessage} CumulusMessage
 * @typedef {import('@cumulus/types').MessageGranule} MessageGranule
 * @typedef {{granules: Array<MessageGranule>}} PayloadWithGranules
*/

/**
 * @param {unknown} payload
 * @returns {payload is PayloadWithGranules}
 */
function payloadHasGranules(payload) {
  return (
    payload instanceof Object
    && 'granules' in payload
    && Array.isArray(payload.granules)
  );
}

/**
 * Reformat object with key attributes at top level.
 *
 * @param {SQSRecord | AWS.SQS.Message} sqsMessage - event bridge event as defined in aws-lambda
 * @returns {Promise<Object>} - message packaged with
 * metadata or 'unknown' where metadata not found
 * {
 *   error: <errorString | 'unknown'>
 *   collection: <collectionName | 'unknown'>
 *   granules: <[granuleIds, ...] | 'unknown'>
 *   execution: <executionArn | 'unknown'>
 *   stateMachine: <stateMachineArn | 'unknown'>
 *   ...originalAttributes
 * }
 */
async function hoistCumulusMessageDetails(sqsMessage) {
  const messageBody = parseSQSMessageBody(sqsMessage);
  let execution = 'unknown';
  let stateMachine = 'unknown';
  let status = 'unknown';
  let time = 'unknown';
  let collection = 'unknown';
  let granules = ['unknown'];
  if (isEventBridgeEvent(messageBody)) {
    execution = messageBody?.detail?.executionArn || 'unknown';
    stateMachine = messageBody?.detail?.stateMachineArn || 'unknown';
    status = messageBody?.detail?.status || 'unknown';
    time = messageBody?.time || 'unknown';
    let cumulusMessage;
    try {
      cumulusMessage = await getCumulusMessageFromExecutionEvent(messageBody);
    } catch (error) {
      cumulusMessage = undefined;
      log.error(`could not parse details from DLQ message body due to ${error}`);
    }

    collection = cumulusMessage?.meta?.collection?.name || 'unknown';

    const payload = cumulusMessage?.payload;
    if (payloadHasGranules(payload)) {
      granules = payload.granules.map((granule) => granule?.granuleId || 'unknown');
    }
  } else {
    log.error('could not parse details from DLQ message body, expected EventBridgeEvent');
  }

  return {
    ...sqsMessage,
    collection,
    granules,
    execution,
    stateMachine,
    status,
    time,
  };
}

/**
 * @typedef {import('aws-lambda').SQSRecord} SQSRecord
 */

/**
 * Lambda handler for saving DLQ reports to DLA in s3
 *
 * @param {{Records: Array<SQSRecord | AWS.SQS.Message>, [key: string]: any}} event - Input payload
 * @returns {Promise<void>}
 */
async function handler(event) {
  if (!process.env.system_bucket) throw new Error('System bucket env var is required.');
  if (!process.env.stackName) throw new Error('Could not determine archive path as stackName env var is undefined.');
  const sqsMessages = get(event, 'Records', []);
  await Promise.all(sqsMessages.map(async (sqsMessage) => {
    const massagedMessage = await hoistCumulusMessageDetails(sqsMessage);
    // version messages with UUID as workflows can produce multiple messages that may all fail.
    const s3Identifier = `${massagedMessage.execution}-${uuidv4()}`;

    await s3PutObject({
      Bucket: process.env.system_bucket,
      Key: `${process.env.stackName}/dead-letter-archive/sqs/${s3Identifier}.json`,
      Body: JSON.stringify(massagedMessage),
    });
  }));
}

module.exports = {
  handler,
  unwrapDeadLetterCumulusMessage,
  hoistCumulusMessageDetails,
};

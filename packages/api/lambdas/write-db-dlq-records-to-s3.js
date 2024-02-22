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
 * @param {{[key: string]: any}} messageBody - event bridge event as defined in aws-lambda
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
async function hoistCumulusMessageDetails(messageBody) {
  const execution = messageBody?.detail?.executionArn || 'unknown';
  const stateMachine = messageBody?.detail?.stateMachineArn || 'unknown';

  let cumulusMessage;
  try {
    if (isEventBridgeEvent(messageBody)) {
      cumulusMessage = await getCumulusMessageFromExecutionEvent(messageBody);
    } else {
      throw new TypeError('Recieved SQS message body not parseable as EventBridgeEvent');
    }
  } catch (error) {
    cumulusMessage = undefined;
    log.error(`could not parse details from SQS message body due to ${error}`);
  }

  const collection = cumulusMessage?.meta?.collection?.name || 'unknown';
  let granules;

  const payload = cumulusMessage?.payload;
  if (payloadHasGranules(payload)) {
    granules = payload.granules.map((granule) => granule?.granuleId || 'unknown');
  } else {
    granules = 'unknown';
  }

  return {
    ...messageBody,
    collection,
    granules,
    execution,
    stateMachine,
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
    const messageBody = parseSQSMessageBody(sqsMessage);
    const massagedMessage = await hoistCumulusMessageDetails(messageBody);

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

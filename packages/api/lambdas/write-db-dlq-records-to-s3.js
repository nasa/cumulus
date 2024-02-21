//@ts-check

'use strict';

const get = require('lodash/get');
const uuidv4 = require('uuid/v4');

const log = require('@cumulus/common/log');
const { isEventBridgeEvent } = require('@cumulus/common/lambda');
const { s3PutObject } = require('@cumulus/aws-client/S3');
const { parseSQSMessageBody } = require('@cumulus/aws-client/SQS');
const { getMessageExecutionName } = require('@cumulus/message/Executions');
const { unwrapDeadLetterCumulusMessage } = require('@cumulus/message/DeadLetterMessage');
const { getCumulusMessageFromExecutionEvent } = require('@cumulus/message/StepFunctions');

/**
 *
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
 *
 * @typedef {import('aws-lambda').EventBridgeEvent} EventBridgeEvent
*/

/**
 * Reformat object with key attributes at top level.
 *
 * @param {{ [key: string]: any }} messageBody - event bridge event as defined in aws-lambda
 * @returns {Promise<Object>} - message packaged with metadata or 'unknown' where metadata not found
 * {
 *   error: <errorString | 'unknown'>
 *   collection: <collectionName | 'unknown'>
 *   granules: <[granuleIds, ...] | 'unknown'>
 *   execution: <executionArn | 'unknown'>
 *   stateMachine: <stateMachineArn | 'unknown'>
 *   ...originalAttributes
 * }
 */
async function formatCumulusDLAObject(messageBody) {
  const execution = messageBody?.detail?.executionArn || 'unknown';
  const stateMachine = messageBody?.detail?.stateMachineArn || 'unknown';

  let cumulusMessage;
  try {
    if (isEventBridgeEvent(messageBody)) {
      cumulusMessage = await getCumulusMessageFromExecutionEvent(messageBody);
    } else {
      cumulusMessage = null;
    }
  } catch {
    cumulusMessage = null;
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
 * Determine execution name from body
 *
 * @param {Object} cumulusMessageObject - cumulus message
 * @returns {string} - <executionName | 'unknown'>
 */
function determineExecutionName(cumulusMessageObject) {
  try {
    return getMessageExecutionName(cumulusMessageObject);
  } catch (error) {
    log.error('Could not find execution name in cumulus_meta:', cumulusMessageObject.cumulus_meta);
    return 'unknown';
  }
}
/**
 * @typedef {import('aws-lambda').SQSRecord} SQSRecord
 */

/**
 * Lambda handler for saving DLQ reports to DLA in s3
 *
 * @param {Object} event - Input payload object
 * @param {Array<SQSRecord | AWS.SQS.Message>} [event.Records] set of  sqsMessages
 * @returns {Promise<void>}
 */
async function handler(event) {
  if (!process.env.system_bucket) throw new Error('System bucket env var is required.');
  if (!process.env.stackName) throw new Error('Could not determine archive path as stackName env var is undefined.');
  const sqsMessages = get(event, 'Records', []);
  await Promise.all(sqsMessages.map(async (sqsMessage) => {
    const messageBody = parseSQSMessageBody(sqsMessage);
    const cumulusMessageObject = await unwrapDeadLetterCumulusMessage(messageBody);
    const executionName = determineExecutionName(cumulusMessageObject);
    // version messages with UUID as workflows can produce multiple messages that may all fail.
    const s3Identifier = `${executionName}-${uuidv4()}`;
    const massagedMessage = await formatCumulusDLAObject(messageBody);
    await s3PutObject({
      Bucket: process.env.system_bucket,
      Key: `${process.env.stackName}/dead-letter-archive/sqs/${s3Identifier}.json`,
      Body: JSON.stringify(massagedMessage),
    });
  }));
}

module.exports = {
  determineExecutionName,
  handler,
  unwrapDeadLetterCumulusMessage,
  formatCumulusDLAObject,
};

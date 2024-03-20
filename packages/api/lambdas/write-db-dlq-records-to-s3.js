//@ts-check

'use strict';

const get = require('lodash/get');
const uuidv4 = require('uuid/v4');
const moment = require('moment');

const { s3PutObject } = require('@cumulus/aws-client/S3');
const { isSQSRecordLike } = require('@cumulus/aws-client/SQS');
const {
  unwrapDeadLetterCumulusMessage,
  hoistCumulusMessageDetails,
} = require('@cumulus/message/DeadLetterMessage');
/**
 *
 * @typedef {import('aws-lambda').SQSRecord} SQSRecord
 */

/**
 * Lambda handler for saving DLQ reports to DLA in s3
 *
 * @param {{Records: Array<SQSRecord>, [key: string]: any}} event - Input payload
 * @returns {Promise<void>}
 */
async function handler(event) {
  if (!process.env.system_bucket) throw new Error('System bucket env var is required.');
  if (!process.env.stackName) throw new Error('Could not determine archive path as stackName env var is undefined.');
  const sqsMessages = get(event, 'Records', []);
  await Promise.all(sqsMessages.map(async (sqsMessage) => {
    let massagedMessage;
    let execution;
    if (isSQSRecordLike(sqsMessage)) {
      massagedMessage = await hoistCumulusMessageDetails(sqsMessage);
      execution = massagedMessage.executionArn;
    } else {
      massagedMessage = sqsMessage;
      execution = null;
    }
    const executionName = execution || 'unknown';
    // version messages with UUID as workflows can produce multiple messages that may all fail.
    const s3Identifier = `${executionName}-${uuidv4()}`;

    const dateString = massagedMessage.time ? moment.utc(massagedMessage.time).format('YYYY-MM-DD') : moment.utc().format('YYYY-MM-DD');
    await s3PutObject({
      Bucket: process.env.system_bucket,
      Key: `${process.env.stackName}/dead-letter-archive/sqs/${dateString}/${s3Identifier}.json`,
      Body: JSON.stringify(massagedMessage),
    });
  }));
}

module.exports = {
  handler,
  unwrapDeadLetterCumulusMessage,
  hoistCumulusMessageDetails,
};

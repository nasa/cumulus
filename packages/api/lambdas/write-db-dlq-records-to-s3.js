//@ts-check

'use strict';

const get = require('lodash/get');

const { s3PutObject } = require('@cumulus/aws-client/S3');
const { isSQSRecordLike } = require('@cumulus/aws-client/SQS');
const {
  unwrapDeadLetterCumulusMessage,
  hoistCumulusMessageDetails,
  getDLAKey,
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
    if (isSQSRecordLike(sqsMessage)) {
      massagedMessage = await hoistCumulusMessageDetails(sqsMessage);
    } else {
      massagedMessage = sqsMessage;
    }

    await s3PutObject({
      Bucket: process.env.system_bucket,
      Key: getDLAKey(process.env.stackName, massagedMessage),
      Body: JSON.stringify(massagedMessage),
    });
  }));
}

module.exports = {
  handler,
  unwrapDeadLetterCumulusMessage,
  hoistCumulusMessageDetails,
};

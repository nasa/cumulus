//@ts-check

'use strict';

const get = require('lodash/get');

const { s3PutObject } = require('@cumulus/aws-client/S3');
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
  const stackName = process.env.stackName;

  /* @type {Array<SQSRecord>} */
  const sqsMessages = get(event, 'Records', []);
  await Promise.all(sqsMessages.map(async (sqsMessage) => {
    const massagedMessage = await hoistCumulusMessageDetails(sqsMessage);

    await s3PutObject({
      Bucket: process.env.system_bucket,
      Key: getDLAKey(stackName, massagedMessage),
      Body: JSON.stringify(massagedMessage),
    });
  }));
}

module.exports = {
  handler,
  unwrapDeadLetterCumulusMessage,
  hoistCumulusMessageDetails,
};

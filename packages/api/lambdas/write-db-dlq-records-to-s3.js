'use strict';

const get = require('lodash/get');
const uuidv4 = require('uuid/v4');

const log = require('@cumulus/common/log');
const { s3PutObject } = require('@cumulus/aws-client/S3');
const { parseSQSMessageBody } = require('@cumulus/aws-client/SQS');
const { getMessageExecutionName } = require('@cumulus/message/Executions');
const { unwrapDeadLetterCumulusMessage } = require('@cumulus/message/DeadLetterMessage');

function determineExecutionName(cumulusMessageObject) {
  try {
    return getMessageExecutionName(cumulusMessageObject);
  } catch (error) {
    log.error('Could not find execution name in cumulus_meta:', cumulusMessageObject.cumulus_meta);
    return 'unknown';
  }
}

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
    await s3PutObject({
      Bucket: process.env.system_bucket,
      Key: `${process.env.stackName}/dead-letter-archive/sqs/${s3Identifier}.json`,
      Body: sqsMessage.body,
      ContentType: 'application/json',
    });
  }));
}

module.exports = {
  determineExecutionName,
  handler,
  unwrapDeadLetterCumulusMessage,
};

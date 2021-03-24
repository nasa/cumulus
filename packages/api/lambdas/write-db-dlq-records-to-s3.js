'use strict';

const get = require('lodash/get');
const { s3PutObject, s3ObjectExists } = require('@cumulus/aws-client/S3');
const { parseSQSMessageBody } = require('@cumulus/aws-client/SQS');

async function handler(event, _) {
  if (!process.env.system_bucket) throw new Error('System bucket env var is required.');
  if (!process.env.stackName) throw new Error('Could not determine archive path as stackName env var is undefined.');
  const sqsMessages = get(event, 'Records', []);
  /* eslint-disable no-restricted-syntax, no-await-in-loop */
  for (const message of sqsMessages) {
    const cumulusMessage = parseSQSMessageBody(message);
    const executionName = cumulusMessage.cumulus_meta.execution_name;
    // version messages as workflows can produce multiple messages that may all fail.
    let s3IdVersionSuffix = 1;
    let s3Identifier = `${executionName}-${s3IdVersionSuffix}`;
    while (await s3ObjectExists({
      Bucket: process.env.system_bucket,
      Key: `${process.env.stackName}/dead-letter-archive/sqs/${s3Identifier}.json`,
    })) {
      s3IdVersionSuffix += 1;
      s3Identifier = `${executionName}-${s3IdVersionSuffix}`;
    }
    await s3PutObject({
      Bucket: process.env.system_bucket,
      Key: `${process.env.stackName}/dead-letter-archive/sqs/${s3Identifier}.json`,
      Body: message.body,
    });
  }
  /* eslint-enable */
}

module.exports = {
  handler,
};

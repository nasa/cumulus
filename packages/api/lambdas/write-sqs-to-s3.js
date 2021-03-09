'use strict';

const get = require('lodash/get');
const { putJsonS3Object } = require('@cumulus/aws-client/S3');

async function handler (event, context) {
  if (!process.env.system_bucket) throw new Error('System bucket env var must be provided!');
  const sqsMessages = get(event, 'Records', []);

  return await Promise.all(sqsMessages.map(async (message) => {
    return await putJsonS3Object(
      process.env.system_bucket,
      `dead_letter_archive/sqs/${message.messageId}.json`,
      message
    );
  }));
}

module.exports = {
  handler,
};

'use strict';

const { S3 } = require('aws-sdk');

/**
 * Receives event trigger from SNS and forwards event message to S3 bucket
 *
 * @param {Object} event - from SNS
 * @returns {Promise} confirmation of added message
 */
async function handler(event) {
  const s3 = new S3();
  const messageString = event.Records[0].Sns.Message;
  const message = JSON.parse(messageString);
  return s3.putObject({
    Bucket: message.cumulus_meta.system_bucket,
    Key: `${message.meta.stack}/test-output/${message.cumulus_meta.execution_name}.output`,
    Body: JSON.stringify(event, null, 2)
  }).promise();
}
exports.handler = handler;

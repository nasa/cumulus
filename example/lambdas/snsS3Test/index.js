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
  const executionRecord = JSON.parse(messageString);
  return s3.putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/test-output/${executionRecord.name}.output`,
    Body: JSON.stringify(event, null, 2)
  }).promise();
}
exports.handler = handler;

'use strict';

const { S3 } = require('aws-sdk');

async function handler(event) {
  const s3 = new S3();
  const messageString = event.Records[0].Sns.Message;
  const message = JSON.parse(messageString);
  return s3.putObject({
    Bucket: message.cumulus_meta.system_bucket,
    Key: `${message.meta.stack}/test-output/${message.cumulus_meta.execution_name}.output`
  }).promise();
}
exports.handler = handler;


const AWS = require('aws-sdk');
const path = require('path');

async function handler(event, _context) {
  const s3 = new AWS.S3();
  // assuming one record per event
  const eventType = event.Records[0].eventName;
  if (!eventType.startsWith('ObjectCreated:')) return null;

  const srcBucket = event.Records[0].s3.bucket.name;
  const srcKey = event.Records[0].s3.object.key;
  return s3.copyObject({
    CopySource: `${srcBucket}/${srcKey}`,
    Bucket: process.env.TARGET_BUCKET,
    Key: `${process.env.TARGET_PREFIX}/${path.basename(srcKey)}`,
    ACL: 'bucket-owner-full-control'
  }).promise();
}

module.exports = {
  handler
};

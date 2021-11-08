'use strict';

const AWS = require('aws-sdk');
const path = require('path');

async function handler(event, _context) {
  const s3 = new AWS.S3();
  return await Promise.all(event.Records.map(async (rec) => {
    const eventType = rec.eventName;
    if (!eventType.startsWith('ObjectCreated:')) return null;
    const srcBucket = rec.s3.bucket.name;
    const srcKey = rec.s3.object.key;
    return await s3.copyObject({
      CopySource: `${srcBucket}/${srcKey}`,
      Bucket: process.env.TARGET_BUCKET,
      Key: `${process.env.TARGET_PREFIX}/${path.basename(srcKey)}`,
      ACL: 'bucket-owner-full-control',
    }).promise();
  }));
}

module.exports = {
  handler,
};

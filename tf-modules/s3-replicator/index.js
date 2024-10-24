'use strict';

const path = require('path');
const { s3 } = require('@cumulus/aws-client/services');

async function handler(event, _context) {
  const targetRegion = process.env.TARGET_REGION;
  const serviceOptions = targetRegion ? { region: targetRegion } : {};
  const s3Client = s3(serviceOptions);
  return await Promise.all(event.Records.map(async (rec) => {
    const eventType = rec.eventName;
    if (!eventType.startsWith('ObjectCreated:')) return null;
    const srcBucket = rec.s3.bucket.name;
    const srcKey = rec.s3.object.key;
    return await s3Client.copyObject({
      CopySource: `${srcBucket}/${srcKey}`,
      Bucket: process.env.TARGET_BUCKET,
      Key: `${process.env.TARGET_PREFIX}/${path.basename(srcKey)}`,
      ACL: 'bucket-owner-full-control',
    });
  }));
}

module.exports = {
  handler,
};

'use strict';

const { S3 } = require('@aws-sdk/client-s3');
const path = require('path');

function _getLogDate(objectKey) {
  return objectKey.match(/(\d{4}-\d{2}-\d{2})/g);
}

async function handler(event, _context) {
  const s3 = new S3();
  // TODO placeholder, needs to be a param or some way for user to configure
  const skipEarlierThanDate = '2023-10-01'

  return await Promise.all(event.Records.map(async (rec) => {
    const eventType = rec.eventName;
    if (!eventType.startsWith('ObjectCreated:')) return null;
    const srcBucket = rec.s3.bucket.name;
    const srcKey = rec.s3.object.key;
    const objectDate = _getLogDate(srcKey)[0];

    // TODO probably moment date comparisons, not strings
    if (objectDate > skipEarlierThanDate) {
      return await s3.copyObject({
        CopySource: `${srcBucket}/${srcKey}`,
        Bucket: process.env.TARGET_BUCKET,
        Key: `${process.env.TARGET_PREFIX}/${path.basename(srcKey)}`,
        ACL: 'bucket-owner-full-control',
      });
    }

    return null;
  }));
}

module.exports = {
  handler,
};

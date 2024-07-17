'use strict';

const { S3 } = require('@aws-sdk/client-s3');
const path = require('path');

function _getLogDate(objectKey) {
  const date = objectKey.match(/(\d{4}-\d{2}-\d{2})/g);
  return Date.parse([date]);
}

async function handler(event, _context) {
  const s3 = new S3();
  const skipEarlierThanDate = Date.parse(process.env.earlierThanDate) || null;

  return await Promise.all(event.Records.map(async (rec) => {
    const eventType = rec.eventName;
    if (!eventType.startsWith('ObjectCreated:')) return null;
    const srcBucket = rec.s3.bucket.name;
    const srcKey = rec.s3.object.key;
    const objectDate = _getLogDate(srcKey);

    if (Number.isFinite(skipEarlierThanDate) && objectDate < skipEarlierThanDate) {
      return null;
    }

    return await s3.copyObject({
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

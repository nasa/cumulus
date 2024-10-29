'use strict';

import path from 'path';
import { Context, S3Event, S3EventRecord } from 'aws-lambda';
import { s3 } from '@cumulus/aws-client/services';

exports.handler = async (event: S3Event, _context: Context) => {
  const targetRegion = process.env.TARGET_REGION;
  const serviceOptions = targetRegion ? { region: targetRegion } : {};
  const s3Client = s3(serviceOptions);
  return await Promise.all(event.Records.map(async (rec: S3EventRecord) => {
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

import Logger from '@cumulus/logger';
import { s3PutObject } from '@cumulus/aws-client/S3';
import { getTeaBucketPath } from './tea';
import { bucketMapObject } from './types';

const log = new Logger({ sender: '@cumulus/tea-map-cache/tea' });

/**
 * Lambda handler that takes a bucketlist and a bucket/key event,
 * queires TEA and write a bucket mapping object to S3.   Returns the bucket map object.
 *
 * @param {Object} event              - Event containing
 * @param {string[]} event.bucketList - An array of buckets to cache values for
 * @param {string} event.s3Bucket     - Bucket to write .json tea map cache file to
 * @param {string} event.s3Key        - Key to write .json tea map cache file to
 * @returns {Promise<Object>}         - A bucketmap object {bucket1: mapping1, bucket2: mapping2}
 */

export const handler = async (event: {
  bucketList: string[],
  s3Bucket: string,
  s3Key: string
}): Promise<bucketMapObject> => {
  const { bucketList, s3Bucket, s3Key } = event;
  if (!bucketList || !s3Bucket || !s3Key) {
    throw new Error('A bucketlist and s3 bucket/key must be provided in the event');
  }
  const teaEndPoint = process.env.TEA_API;
  if (typeof teaEndPoint !== 'string') {
    throw new TypeError('process.env.TEA_API must be defined as a string to use this lambda');
  }

  const bucketMapPromises = event.bucketList.map(async (bucket) => ({
    [bucket]: await getTeaBucketPath({ bucket, teaEndPoint })
  }));
  const bucketMapObjects = await Promise.all(bucketMapPromises);

  const bucketMap = bucketMapObjects.reduce(
    (map, obj) => Object.assign(map, obj), {}
  );

  await s3PutObject({
    Bucket: s3Bucket,
    Key: s3Key,
    Body: JSON.stringify(bucketMap)
  });
  log.info(`Wrote bucketmap ${JSON.stringify(bucketMap)} to ${s3Bucket}/${s3Key}`);
  return bucketMap;
};

/* eslint-disable no-console */
const AWS = require('aws-sdk');
const { getTeaBucketPath } = require('./tea');

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
async function handler(event) {
  const { bucketList, s3Bucket, s3Key } = event;
  if (!bucketList || !s3Bucket || !s3Key) {
    throw new Error('A bucketlist and s3 bucket/key must be provided in the event');
  }

  const s3 = new AWS.S3();

  const bucketMapPromises = event.bucketList.map(async (bucket) => ({
    [bucket]: await getTeaBucketPath(bucket, process.env.TEA_API)
  }));
  const bucketMapObjects = await Promise.all(bucketMapPromises);

  const bucketMap = bucketMapObjects.reduce(
    (map, obj) => Object.assign(map, obj), {}
  );

  await s3.putObject({
    Bucket: s3Bucket,
    Key: s3Key,
    Body: JSON.stringify(bucketMap)
  }).promise();
  console.log(`Wrote bucketmap ${JSON.stringify(bucketMap)} to ${s3Bucket}/${s3Key}`);
  return bucketMap;
}

exports.handler = handler;

/* eslint-disable no-console */
const AWS = require('aws-sdk');
const { getTeaBucketPath } = require('./tea');

/**
 * Lambda handler that takes a bucketlist and a S3URI to write and
 * queries TEA for a bucket mapping object.   Returns the bucket map object
 *
 * @param {Object} event - Event containing
 * @param {string} event.bucketList - An array of buckets to cache values for
 * @returns {Promise<Object>} - Returns a bucketmap object {bucket1: mapping1, bucket2: mapping2}
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

  let bucketMap = {};
  bucketMapObjects.forEach((object) => {
    bucketMap = { ...bucketMap, ...object };
  });

  await s3.putObject({
    Bucket: s3Bucket,
    Key: s3Key,
    Body: JSON.stringify(bucketMap)
  }).promise();
  console.log(`Wrote bucketmap ${JSON.stringify(bucketMap)} to ${s3Bucket}/${s3Key}`);
  return bucketMap;
}

exports.handler = handler;

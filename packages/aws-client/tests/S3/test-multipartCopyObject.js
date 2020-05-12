'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const fs = require('fs');
const { createHash } = require('crypto');
const {
  createBucket,
  multipartCopyObject,
  recursivelyDeleteS3Bucket
} = require('../../S3');
const { s3 } = require('../../services');

const MB = 1024 * 1024;

// Create a random id with a prefix
const randomId = (prefix) =>
  `${prefix}-${cryptoRandomString({ length: 6 })}`;

// Create an object in with random data of the given size
const createDummyObject = ({ Bucket, Key, size }) => {
  const readStream = fs.createReadStream('/dev/urandom', { end: size - 1 });

  return s3().upload({
    Bucket,
    Key,
    Body: readStream
  }).promise();
};

// Calculate the MD5 checksum of an object
const md5OfObject = ({ Bucket, Key }) => new Promise(
  (resolve) => {
    const hash = createHash('MD5');

    hash.on(
      'finish',
      () => resolve(hash.read().toString('hex'))
    );

    s3().getObject({ Bucket, Key }).createReadStream().pipe(hash);
  }
);

test('multipartCopyObject() copies a file between buckets', async (t) => {
  const sourceBucket = randomId('source-bucket');
  const sourceKey = randomId('source-key');
  const destinationBucket = randomId('destination-bucket');
  const destinationKey = randomId('destination-key');

  try {
    await createBucket(sourceBucket);
    await createBucket(destinationBucket);

    await createDummyObject({
      Bucket: sourceBucket,
      Key: sourceKey,
      size: 6 * MB
    });

    const sourceChecksum = await md5OfObject({
      Bucket: sourceBucket,
      Key: sourceKey
    });

    await multipartCopyObject({
      sourceBucket,
      sourceKey,
      destinationBucket,
      destinationKey
    });

    const destinationChecksum = await md5OfObject({
      Bucket: destinationBucket,
      Key: destinationKey
    });

    t.is(sourceChecksum, destinationChecksum, 'Source and destination checksums do not match');
  } finally {
    await recursivelyDeleteS3Bucket(sourceBucket);
    await recursivelyDeleteS3Bucket(destinationBucket);
  }
});

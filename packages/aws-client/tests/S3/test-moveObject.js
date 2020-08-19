'use strict';

const cryptoRandomString = require('crypto-random-string');
const test = require('ava');

const {
  createBucket,
  getS3Object,
  moveObject,
  recursivelyDeleteS3Bucket,
  s3ObjectExists,
  s3PutObject,
} = require('../../S3');

// Create a random id with a prefix
const randomId = (prefix) =>
  `${prefix}-${cryptoRandomString({ length: 6 })}`;

test.before(async (t) => {
  t.context.sourceBucket = randomId('source-bucket');
  t.context.destinationBucket = randomId('destination-bucket');

  await createBucket(t.context.sourceBucket);
  await createBucket(t.context.destinationBucket);
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.sourceBucket);
  await recursivelyDeleteS3Bucket(t.context.destinationBucket);
});

test('moveObject() copies the source file to the destination', async (t) => {
  const { sourceBucket, destinationBucket } = t.context;

  const sourceKey = randomId('source-key');
  const destinationKey = randomId('destination-key');

  await s3PutObject({
    Bucket: sourceBucket,
    Key: sourceKey,
    Body: 'asdf',
  });

  await moveObject({
    sourceBucket,
    sourceKey,
    destinationBucket,
    destinationKey,
  });

  const copiedObject = await getS3Object(destinationBucket, destinationKey);

  t.is(copiedObject.Body.toString(), 'asdf');
});

test('moveObject() deletes the source file', async (t) => {
  const { sourceBucket, destinationBucket } = t.context;

  const sourceKey = randomId('source-key');
  const destinationKey = randomId('destination-key');

  await s3PutObject({
    Bucket: sourceBucket,
    Key: sourceKey,
    Body: 'asdf',
  });

  await moveObject({
    sourceBucket,
    sourceKey,
    destinationBucket,
    destinationKey,
  });

  t.false(
    await s3ObjectExists({
      Bucket: sourceBucket,
      Key: sourceKey,
    })
  );
});

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
  getObjectStreamContents,
  copyObject,
  getJsonS3Object,
  getTextObject,
} = require('../../S3');

const MB = 1024 * 1024;
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

test('moveObject() moves the source file to the destination', async (t) => {
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
    chunkSize: 5 * MB,
  });



  t.is(await getTextObject(destinationBucket, destinationKey), 'asdf');

  t.false(await s3ObjectExists({ Bucket: sourceBucket, Key: sourceKey }));
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

test('moveObject() moves a 0 byte file', async (t) => {
  // This test doesn't really prove anything since Localstack does not behave exactly like S3.
  // However, if Localstack fixes multipart upload handling to match real S3 behavior, this will
  // be a useful test.
  const { sourceBucket, destinationBucket } = t.context;

  const sourceKey = randomId('source-key');
  const destinationKey = '0byte.dat';

  await s3PutObject({
    Bucket: sourceBucket,
    Key: sourceKey,
    // ensure file has 0 bytes
    Body: '',
  });

  await moveObject({
    sourceBucket,
    sourceKey,
    destinationBucket,
    destinationKey,
    chunkSize: 5 * MB,
  });

  t.true(
    await s3ObjectExists({
      Bucket: destinationBucket,
      Key: destinationKey,
    })
  );

  const copiedObject = await getS3Object(destinationBucket, destinationKey);
  t.is(await getObjectStreamContents(copiedObject.Body), '');
});

test('copyObject() copies the source file to the destination', async (t) => {
  const { sourceBucket, destinationBucket } = t.context;

  const sourceKey = randomId('source-key');
  const destinationKey = randomId('destination-key');

  await s3PutObject({
    Bucket: sourceBucket,
    Key: sourceKey,
    Body: 'asdf',
  });

  await copyObject({
    sourceBucket,
    sourceKey,
    destinationBucket,
    destinationKey,
    chunkSize: 5 * MB,
  });


  t.is(await getTextObject(destinationBucket, destinationKey), 'asdf');

  t.is(await getTextObject(sourceBucket, sourceKey), 'asdf');
});
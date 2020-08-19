'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const fs = require('fs');
const { createHash } = require('crypto');
const {
  createBucket,
  multipartCopyObject,
  recursivelyDeleteS3Bucket,
} = require('../../S3');
const { s3 } = require('../../services');

const MB = 1024 * 1024;

// Create a random id with a prefix
const randomId = (prefix) =>
  `${prefix}-${cryptoRandomString({ length: 6 })}`;

// Create an object in with random data of the given size
const createDummyObject = ({ Bucket, Key, size, contentType }) => {
  const readStream = fs.createReadStream('/dev/urandom', { end: size - 1 });

  return s3().upload({
    Bucket,
    Key,
    Body: readStream,
    ContentType: contentType,
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

test('multipartCopyObject() copies a file between buckets', async (t) => {
  const { sourceBucket, destinationBucket } = t.context;

  const sourceKey = randomId('source-key');
  const destinationKey = randomId('destination-key');

  await createDummyObject({
    Bucket: sourceBucket,
    Key: sourceKey,
    size: 6 * MB,
  });

  const sourceChecksum = await md5OfObject({
    Bucket: sourceBucket,
    Key: sourceKey,
  });

  const { etag } = await multipartCopyObject({
    sourceBucket,
    sourceKey,
    destinationBucket,
    destinationKey,
  });

  const destinationChecksum = await md5OfObject({
    Bucket: destinationBucket,
    Key: destinationKey,
  });

  t.is(sourceChecksum, destinationChecksum, 'Source and destination checksums do not match');
  t.truthy(etag, 'Missing etag in copy response');
});

test("multipartCopyObject() sets the object's ACL", async (t) => {
  const { sourceBucket, destinationBucket } = t.context;

  const sourceKey = randomId('source-key');
  const destinationKey = randomId('destination-key');

  await createDummyObject({
    Bucket: sourceBucket,
    Key: sourceKey,
    size: 10,
  });

  await multipartCopyObject({
    sourceBucket,
    sourceKey,
    destinationBucket,
    destinationKey,
    ACL: 'public-read',
  });

  const destinationAcls = await s3().getObjectAcl({
    Bucket: destinationBucket,
    Key: destinationKey,
  }).promise();

  const allUsersGrant = destinationAcls.Grants.find(
    (grant) =>
      grant.Grantee.URI === 'http://acs.amazonaws.com/groups/global/AllUsers'
  );

  t.is(allUsersGrant.Permission, 'READ');
});

test('multipartCopyObject() copies content type', async (t) => {
  const { sourceBucket, destinationBucket } = t.context;

  const sourceKey = randomId('source-key');
  const destinationKey = randomId('destination-key');

  await createDummyObject({
    Bucket: sourceBucket,
    Key: sourceKey,
    size: 5,
    contentType: 'application/xml',
  });

  await multipartCopyObject({
    sourceBucket,
    sourceKey,
    destinationBucket,
    destinationKey,
  });

  const copiedObject = await s3().headObject({
    Bucket: destinationBucket,
    Key: destinationKey,
  }).promise();

  t.deepEqual(
    copiedObject.ContentType,
    'application/xml'
  );
});

'use strict';

// It seems like the Tagging param to S3.createMultipartUpload() is ignored
// by LocalStack, so using proxyquire to test tagging instead.

const fs = require('fs');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const { s3 } = require('../../services');

const stubS3MultipartUploads = {};

const { createBucket, multipartCopyObject, recursivelyDeleteS3Bucket } = proxyquire(
  '../../S3',
  {
    './lib/S3MultipartUploads': stubS3MultipartUploads,
  }
);

const randomId = (prefix) =>
  `${prefix}-${cryptoRandomString({ length: 6 })}`;

// Create an object in with random data of the given size
const createDummyObject = async ({ Bucket, Key, size, tags = {} }) => {
  const readStream = fs.createReadStream('/dev/urandom', { end: size - 1 });

  await s3().upload({
    Bucket,
    Key,
    Body: readStream,
  }).promise();

  await s3().putObjectTagging({
    Bucket,
    Key,
    Tagging: {
      TagSet: Object.entries(tags).map(
        ([tagKey, tagValue]) => ({ Key: tagKey, Value: tagValue })
      ),
    },
  }).promise();
};

test.before(async (t) => {
  t.context.sourceBucket = randomId('source-bucket');
  t.context.destinationBucket = randomId('destination-bucket');

  await createBucket(t.context.sourceBucket);
  await createBucket(t.context.destinationBucket);
});

test.beforeEach((t) => {
  t.context.fakeCreateMultipartUpload = sinon.fake.resolves({ UploadId: 'i-123' });
  stubS3MultipartUploads.createMultipartUpload = t.context.fakeCreateMultipartUpload;

  stubS3MultipartUploads.uploadPartCopy = sinon.fake.resolves({
    PartNumber: 1,
    CopyPartResult: {
      ETag: 'etag-1',
    },
  });

  stubS3MultipartUploads.completeMultipartUpload = sinon.fake.resolves({
    etag: 'etag-complete',
  });
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.sourceBucket);
  await recursivelyDeleteS3Bucket(t.context.destinationBucket);
});

test.serial('multipartCopyObject() copies tags if copyTags=true', async (t) => {
  const {
    sourceBucket,
    destinationBucket,
    fakeCreateMultipartUpload,
  } = t.context;

  const sourceKey = randomId('source-key');
  const destinationKey = randomId('destination-key');

  await createDummyObject({
    Bucket: sourceBucket,
    Key: sourceKey,
    size: 10,
    tags: { key: 'value' },
  });

  await multipartCopyObject({
    sourceBucket,
    sourceKey,
    destinationBucket,
    destinationKey,
    copyTags: true,
  });

  t.true(
    fakeCreateMultipartUpload.calledOnceWith(
      sinon.match({ Tagging: 'key=value' })
    )
  );
});

test.serial('multipartCopyObject() does not copy tags if copyTags=false', async (t) => {
  const {
    sourceBucket,
    destinationBucket,
    fakeCreateMultipartUpload,
  } = t.context;

  const sourceKey = randomId('source-key');
  const destinationKey = randomId('destination-key');

  await createDummyObject({
    Bucket: sourceBucket,
    Key: sourceKey,
    size: 10,
    tags: { key: 'value' },
  });

  await multipartCopyObject({
    sourceBucket,
    sourceKey,
    destinationBucket,
    destinationKey,
    copyTags: false,
  });

  t.true(fakeCreateMultipartUpload.calledOnce);

  t.is(
    fakeCreateMultipartUpload.firstCall.args[0].Tagging,
    undefined
  );
});

test.serial('multipartCopyObject() does not copy tags by default', async (t) => {
  const {
    sourceBucket,
    destinationBucket,
    fakeCreateMultipartUpload,
  } = t.context;

  const sourceKey = randomId('source-key');
  const destinationKey = randomId('destination-key');

  await createDummyObject({
    Bucket: sourceBucket,
    Key: sourceKey,
    size: 10,
    tags: { key: 'value' },
  });

  await multipartCopyObject({
    sourceBucket,
    sourceKey,
    destinationBucket,
    destinationKey,
  });

  t.true(fakeCreateMultipartUpload.calledOnce);

  t.is(
    fakeCreateMultipartUpload.firstCall.args[0].Tagging,
    undefined
  );
});

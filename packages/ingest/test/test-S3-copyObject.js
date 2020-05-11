'use strict';

const test = require('ava');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

const stubAwsClientS3Module = {
  getObjectSize: async (_, key) => {
    const GB = 1024 * 1024 * 1024;

    if (key === 'one-GB') return GB;
    if (key === 'five-GB') return 5 * GB;
    if (key === 'six-GB') return 6 * GB;

    throw new Error(`Unexpected key: ${key}`);
  }
};

const { copyObject } = proxyquire(
  '../S3',
  { '@cumulus/aws-client/S3': stubAwsClientS3Module }
);

test.serial('copyObject() uses S3.s3CopyObject() to copy a file smaller than 5 GB', async (t) => {
  const fakeS3CopyObject = sinon.fake.resolves({});

  stubAwsClientS3Module.s3CopyObject = fakeS3CopyObject;

  await copyObject({
    sourceBucket: 'source-bucket',
    sourceKey: 'one-GB',
    destinationBucket: 'destination-bucket',
    destinationKey: 'destination-key'
  });

  t.true(
    fakeS3CopyObject.calledOnceWith(
      sinon.match({
        Bucket: 'destination-bucket',
        Key: 'destination-key',
        CopySource: 'source-bucket/one-GB'
      })
    )
  );
});

test.serial('copyObject() uses S3.s3CopyObject() to copy a 5 GB file', async (t) => {
  const fakeS3CopyObject = sinon.fake.resolves({});

  stubAwsClientS3Module.s3CopyObject = fakeS3CopyObject;

  await copyObject({
    sourceBucket: 'source-bucket',
    sourceKey: 'five-GB',
    destinationBucket: 'destination-bucket',
    destinationKey: 'destination-key'
  });

  t.true(
    fakeS3CopyObject.calledOnceWith(
      sinon.match({
        Bucket: 'destination-bucket',
        Key: 'destination-key',
        CopySource: 'source-bucket/five-GB'
      })
    )
  );
});

test.serial('copyObject() uses S3.multipartCopyObject() to copy a file larger than 5 GB', async (t) => {
  const fakeMultipartCopyObject = sinon.fake.resolves({});

  stubAwsClientS3Module.multipartCopyObject = fakeMultipartCopyObject;

  await copyObject({
    sourceBucket: 'source-bucket',
    sourceKey: 'six-GB',
    destinationBucket: 'destination-bucket',
    destinationKey: 'destination-key'
  });

  t.true(
    fakeMultipartCopyObject.calledOnceWith(
      sinon.match({
        sourceBucket: 'source-bucket',
        sourceKey: 'six-GB',
        destinationBucket: 'destination-bucket',
        destinationKey: 'destination-key'
      })
    )
  );
});

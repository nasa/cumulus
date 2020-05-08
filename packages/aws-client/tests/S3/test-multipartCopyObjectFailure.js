'use strict';

const test = require('ava');
const proxyquire = require('proxyquire');

let abortMultipartUploadWasCalled = false;
let abortMultipartUploadParams;

const fakeS3Service = () => ({
  abortMultipartUpload: (params) => ({
    promise: async () => {
      abortMultipartUploadWasCalled = true;
      abortMultipartUploadParams = params;
    }
  }),
  createMultipartUpload: () => ({
    promise: () => Promise.resolve({
      UploadId: 'abc-123'
    })
  }),
  headObject: () => ({
    promise: () => Promise.resolve({ ContentLength: 5 })
  }),
  uploadPartCopy: () => ({
    promise: () => Promise.reject(new Error('uh oh'))
  })
});

const S3 = proxyquire(
  '../../S3',
  {
    './services': {
      s3: fakeS3Service
    }
  }
);

test('multipartCopyObject() aborts the upload if something fails', async (t) => {
  await t.throwsAsync(
    S3.multipartCopyObject({
      sourceBucket: 'a',
      sourceKey: 'b',
      destinationBucket: 'c',
      destinationKey: 'd'
    })
  );

  t.true(abortMultipartUploadWasCalled);

  t.deepEqual(
    abortMultipartUploadParams,
    {
      Bucket: 'c',
      Key: 'd',
      UploadId: 'abc-123'
    }
  );
});

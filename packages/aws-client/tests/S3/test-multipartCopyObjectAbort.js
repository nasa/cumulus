'use strict';

const test = require('ava');
const proxyquire = require('proxyquire');

let abortMultipartUploadWasCalled = false;
let abortMultipartUploadParams;

const S3 = proxyquire(
  '../../S3',
  {
    './services': {
      s3: () => ({
        headObject: () => ({
          promise: async () => ({ ContentLength: 5 }),
        }),
      }),
    },
    './lib/S3MultipartUploads': {
      abortMultipartUpload: async (params) => {
        abortMultipartUploadWasCalled = true;
        abortMultipartUploadParams = params;
      },
      createMultipartUpload: () => Promise.resolve({ UploadId: 'abc-123' }),
      uploadPartCopy: () => Promise.reject(new Error('uh oh')),
    },
  }
);

test('multipartCopyObject() aborts the upload if something fails', async (t) => {
  await t.throwsAsync(
    S3.multipartCopyObject({
      sourceBucket: 'source-bucket',
      sourceKey: 'source-key',
      destinationBucket: 'destination-bucket',
      destinationKey: 'destination-key',
    })
  );

  t.true(abortMultipartUploadWasCalled);

  t.deepEqual(
    abortMultipartUploadParams,
    {
      Bucket: 'destination-bucket',
      Key: 'destination-key',
      UploadId: 'abc-123',
    }
  );
});

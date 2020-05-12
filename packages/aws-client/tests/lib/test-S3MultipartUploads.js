'use strict';

const test = require('ava');
const {
  buildCompleteMultipartUploadParams,
  buildUploadPartCopyParams,
  createMultipartChunks
} = require('../../lib/S3MultipartUploads');

test('createMultipartChunks(0) returns the correct chunks', (t) => {
  t.deepEqual(
    createMultipartChunks(0),
    []
  );
});

test('createMultipartChunks(9, 10) returns the correct chunks', (t) => {
  t.deepEqual(
    createMultipartChunks(9, 10),
    [
      { start: 0, end: 8 }
    ]
  );
});

test('createMultipartChunks(10, 10) returns the correct chunks', (t) => {
  t.deepEqual(
    createMultipartChunks(10, 10),
    [
      { start: 0, end: 9 }
    ]
  );
});

test('createMultipartChunks(11, 10) returns the correct chunks', (t) => {
  t.deepEqual(
    createMultipartChunks(11, 10),
    [
      { start: 0, end: 9 },
      { start: 10, end: 10 }
    ]
  );
});

test('createMultipartChunks(12, 10) returns the correct chunks', (t) => {
  t.deepEqual(
    createMultipartChunks(12, 10),
    [
      { start: 0, end: 9 },
      { start: 10, end: 11 }
    ]
  );
});

test('buildUploadPartCopyParams() with no chunks returns the correct params', (t) => {
  t.deepEqual(
    buildUploadPartCopyParams({
      chunks: []
    }),
    []
  );
});

test('buildUploadPartCopyParams() with multiple chunks returns the correct params', (t) => {
  t.deepEqual(
    buildUploadPartCopyParams({
      uploadId: 'upload-id',
      sourceBucket: 'source-bucket',
      sourceKey: 'source-key',
      destinationBucket: 'destination-bucket',
      destinationKey: 'destination-key',
      chunks: [
        { start: 0, end: 5 },
        { start: 6, end: 10 }
      ]
    }),
    [
      {
        UploadId: 'upload-id',
        Bucket: 'destination-bucket',
        Key: 'destination-key',
        PartNumber: 1,
        CopySource: '/source-bucket/source-key',
        CopySourceRange: 'bytes=0-5'
      },
      {
        UploadId: 'upload-id',
        Bucket: 'destination-bucket',
        Key: 'destination-key',
        PartNumber: 2,
        CopySource: '/source-bucket/source-key',
        CopySourceRange: 'bytes=6-10'
      }
    ]
  );
});

test('buildCompleteMultipartUploadParams() returns the correct params', (t) => {
  const actualResult = buildCompleteMultipartUploadParams({
    uploadId: 'upload-id',
    destinationBucket: 'destination-bucket',
    destinationKey: 'destination-key',
    uploadPartCopyResponses: [
      {
        PartNumber: 1,
        CopyPartResult: {
          ETag: 'abc-1'
        }
      },
      {
        PartNumber: 2,
        CopyPartResult: {
          ETag: 'xyz-2'
        }
      }
    ]
  });

  const expectedResult = {
    UploadId: 'upload-id',
    Bucket: 'destination-bucket',
    Key: 'destination-key',
    MultipartUpload: {
      Parts: [
        {
          PartNumber: 1,
          ETag: 'abc-1'
        },
        {
          PartNumber: 2,
          ETag: 'xyz-2'
        }
      ]
    }
  };

  t.deepEqual(actualResult, expectedResult);
});

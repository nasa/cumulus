'use strict';

const fs = require('fs');
const test = require('ava');
const { createHash } = require('crypto');
const { s3 } = require('../../services');
const {
  buildCompleteMultipartUploadParams,
  buildUploadPartCopyParams,
  createMultipartChunks
} = require('../../S3');

// Not used yet
const createDummyFile = (size) =>
  new Promise((resolve) => {
    const writeStream = fs.createWriteStream('file.dat');
    writeStream.on('finish', () => resolve());

    const readStream = fs.createReadStream('/dev/zero', { end: size - 1 });
    readStream.pipe(writeStream);
  });

// Not used yet
const md5OfObject = (Bucket, Key) => new Promise(
  (resolve) => {
    const hash = createHash('MD5');

    hash.on(
      'finish',
      () => resolve(hash.read().toString('hex'))
    );

    s3().getObject({ Bucket, Key }).createReadStream().pipe(hash);
  }
);

test('createMultipartChunks() returns the correct chunks', (t) => {
  t.deepEqual(
    createMultipartChunks(0),
    []
  );

  t.deepEqual(
    createMultipartChunks(9, 10),
    [
      { start: 0, end: 8 }
    ]
  );

  t.deepEqual(
    createMultipartChunks(10, 10),
    [
      { start: 0, end: 9 }
    ]
  );

  t.deepEqual(
    createMultipartChunks(11, 10),
    [
      { start: 0, end: 9 },
      { start: 10, end: 10 }
    ]
  );

  t.deepEqual(
    createMultipartChunks(12, 10),
    [
      { start: 0, end: 9 },
      { start: 10, end: 11 }
    ]
  );
});

test('buildUploadPartCopyParams() returns the correct params', (t) => {
  t.deepEqual(
    buildUploadPartCopyParams({
      chunks: []
    }),
    []
  );

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

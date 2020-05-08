'use strict';

const cryptoRandomString = require('crypto-random-string');
const fs = require('fs');
const test = require('ava');
const { createHash } = require('crypto');
const { s3 } = require('../../services');
const S3 = require('../../S3');

const randomId = (prefix, separator = '-') =>
  `${prefix}${separator}${cryptoRandomString({ length: 6 })}`;

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
    S3.createMultipartChunks(0),
    []
  );

  t.deepEqual(
    S3.createMultipartChunks(9, 10),
    [
      { start: 0, end: 8 }
    ]
  );

  t.deepEqual(
    S3.createMultipartChunks(10, 10),
    [
      { start: 0, end: 9 }
    ]
  );

  t.deepEqual(
    S3.createMultipartChunks(11, 10),
    [
      { start: 0, end: 9 },
      { start: 10, end: 10 }
    ]
  );

  t.deepEqual(
    S3.createMultipartChunks(12, 10),
    [
      { start: 0, end: 9 },
      { start: 10, end: 11 }
    ]
  );
});

test('buildUploadPartCopyParams() returns the correct params', (t) => {
  t.deepEqual(
    S3.buildUploadPartCopyParams({
      chunks: []
    }),
    []
  );

  t.deepEqual(
    S3.buildUploadPartCopyParams({
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
  const actualResult = S3.buildCompleteMultipartUploadParams({
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

test('multipartCopyObject() copies a file between S3 buckets', async (t) => {
  const sourceBucket = randomId('source-bucket');
  const destinationBucket = randomId('destination-bucket');

  try {
    await S3.createBucket(sourceBucket);
    await S3.createBucket(destinationBucket);

    t.pass();
  } finally {
    await S3.recursivelyDeleteS3Bucket(sourceBucket);
    await S3.recursivelyDeleteS3Bucket(destinationBucket);
  }
});

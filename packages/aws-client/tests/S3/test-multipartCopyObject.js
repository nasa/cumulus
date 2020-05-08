'use strict';

const cryptoRandomString = require('crypto-random-string');
const fs = require('fs');
const test = require('ava');
const { createHash } = require('crypto');
const {
  buildCompleteMultipartUploadParams,
  buildUploadPartCopyParams,
  createBucket,
  createMultipartChunks,
  multipartCopyObject,
  recursivelyDeleteS3Bucket
} = require('../../S3');
const { s3 } = require('../../services');

const randomId = (prefix, separator = '-') =>
  `${prefix}${separator}${cryptoRandomString({ length: 6 })}`;

// Create an object in with random data of the given size
const createDummyObject = ({ Bucket, Key, size }) => {
  const readStream = fs.createReadStream('/dev/urandom', { end: size - 1 });

  return s3().upload({
    Bucket,
    Key,
    Body: readStream
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

test('multipartCopyObject() copies a file between buckets', async (t) => {
  const sourceBucket = randomId('source-bucket');
  const sourceKey = randomId('source-key');
  const destinationBucket = randomId('destination-bucket');
  const destinationKey = randomId('destination-key');

  try {
    await createBucket(sourceBucket);
    await createBucket(destinationBucket);

    await createDummyObject({
      Bucket: sourceBucket,
      Key: sourceKey,
      size: 5 * 1024 * 1024
    });

    const sourceChecksum = await md5OfObject({
      Bucket: sourceBucket,
      Key: sourceKey
    });

    await multipartCopyObject({
      sourceBucket,
      sourceKey,
      destinationBucket,
      destinationKey
    });

    const destinationChecksum = await md5OfObject({
      Bucket: destinationBucket,
      Key: destinationKey
    });

    t.is(sourceChecksum, destinationChecksum, 'Source and destination checksums do not match');
  } finally {
    await recursivelyDeleteS3Bucket(sourceBucket);
    await recursivelyDeleteS3Bucket(destinationBucket);
  }
});

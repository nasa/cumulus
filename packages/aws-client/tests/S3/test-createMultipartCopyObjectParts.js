'use strict';

const fs = require('fs');
const test = require('ava');
const { createHash } = require('crypto');
const { s3 } = require('../../services');
const { buildUploadPartCopyParams, createMultipartChunks } = require('../../S3');

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

test('createMultipartChunks returns the correct chunks', (t) => {
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

test('buildUploadPartCopyParams returns the correct params', (t) => {
  t.deepEqual(
    buildUploadPartCopyParams({
      chunks: []
    }),
    []
  );
});

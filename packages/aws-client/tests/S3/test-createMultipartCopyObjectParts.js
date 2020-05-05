'use strict';

const fs = require('fs');
const test = require('ava');
const { createHash } = require('crypto');
const { s3 } = require('../../services');
const { createMultipartCopyObjectParts } = require('../../S3');

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

test('createMultipartCopyObjectParts returns the correct parts', (t) => {
  t.deepEqual(
    createMultipartCopyObjectParts(0),
    []
  );

  t.deepEqual(
    createMultipartCopyObjectParts(9, 10),
    [{ PartNumber: 1, CopySourceRange: 'bytes=0-8' }]
  );

  t.deepEqual(
    createMultipartCopyObjectParts(10, 10),
    [{ PartNumber: 1, CopySourceRange: 'bytes=0-9' }]
  );

  t.deepEqual(
    createMultipartCopyObjectParts(11, 10),
    [
      { PartNumber: 1, CopySourceRange: 'bytes=0-9' },
      { PartNumber: 2, CopySourceRange: 'bytes=10-10' }
    ]
  );

  t.deepEqual(
    createMultipartCopyObjectParts(12, 10),
    [
      { PartNumber: 1, CopySourceRange: 'bytes=0-9' },
      { PartNumber: 2, CopySourceRange: 'bytes=10-11' }
    ]
  );
});

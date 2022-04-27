'use strict';

const test = require('ava');
const { setS3FileSize } = require('../../../lib/FileUtils');

test.before((t) => {
  t.context.fakeS3 = {
    headObject: (params = {}) => {
      if (params.Key === 'four-byte-file') {
        return Promise.resolve({ ContentLength: 4 });
      }

      if (params.Key === 'does-not-exist') {
        const error = new Error();
        error.code = 'NotFound';
        return Promise.reject(error);
      }

      return Promise.reject(new TypeError(`Unexpected key: ${params.Key}`));
    },
  };
});

test('setS3FileSize() returns the value of the fileSize property in the size field', async (t) => {
  const file = { fileSize: 1234 };

  t.deepEqual(
    await setS3FileSize(t.context.fakeS3, file),
    { size: 1234 }
  );
});

test('setS3FileSize() returns the value of the size property in the size field', async (t) => {
  const file = { size: 1234 };

  t.deepEqual(
    await setS3FileSize(t.context.fakeS3, file),
    file
  );
});

test('setS3FileSize() prefers size over fileSize', async (t) => {
  const file = {
    fileSize: 1234,
    size: 4321,
  };

  t.is(
    (await setS3FileSize(t.context.fakeS3, file)).size,
    4321
  );
});

test('setS3FileSize() fetches the file size from S3 if file and fileSize are not specified', async (t) => {
  const file = { key: 'four-byte-file' };

  const updatedFile = await setS3FileSize(t.context.fakeS3, file);

  t.is(updatedFile.size, 4);
});

test('setS3FileSize() returns the file without a size if size and fileSize are not set, and the object does not exist in S3', async (t) => {
  const file = { key: 'does-not-exist' };

  const updatedFile = await setS3FileSize(t.context.fakeS3, file);

  t.deepEqual(updatedFile, file);
});

test('setS3FileSize() returns input file if S3 request to get file size throws error', async (t) => {
  const file = { };

  const fakeS3 = {
    headObject: (params = {}) => {
      throw new TypeError(`Unexpected key: ${params.Key}`);
    },
  };

  t.deepEqual(
    await setS3FileSize(fakeS3, file),
    {}
  );
});

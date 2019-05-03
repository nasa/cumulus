'use strict';

const test = require('ava');
const { setS3FileSize } = require('../../../lib/FileUtils');

test('setS3FileSize() returns the value of the fileSize property in the size field', async (t) => {
  const file = { fileSize: 1234 };

  t.deepEqual(
    await setS3FileSize(file),
    { size: 1234 }
  );
});

test('setS3FileSize() returns the value of the size property in the size field', async (t) => {
  const file = { size: 1234 };

  t.deepEqual(
    await setS3FileSize(file),
    file
  );
});

test('setS3FileSize() prefers size over fileSize', async (t) => {
  const file = {
    fileSize: 1234,
    size: 4321
  };

  t.is(
    (await setS3FileSize(file)).size,
    4321
  );
});

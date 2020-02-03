'use strict';

const rewire = require('rewire');
const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');

const lock = rewire('../lock');
const { checkOldLocks, countLock } = lock;

// 5 * 60 seconds * 1000 milliseconds
const fiveMinutes = 5 * 60 * 1000;

test.before(() => {
  lock.__set__('deleteS3Object', () => Promise.resolve());
});

test.beforeEach(async (t) => {
  t.context.bucket = randomString();
  t.context.providerName = randomString();
});

test('checkOldLocks() returns correct number of locks', async (t) => {
  const { bucket, providerName } = t.context;

  let count = await checkOldLocks(bucket, []);
  t.is(count, 0);

  count = await checkOldLocks(bucket, [
    {
      Key: `lock/${providerName}/test`,
      LastModified: Date.now()
    },
    {
      Key: `lock/${providerName}/test2`,
      LastModified: Date.now() - (fiveMinutes + 1)
    },
    {
      Key: `lock/${providerName}/test3`,
      LastModified: Date.now() - (fiveMinutes + 1)
    }
  ]);
  t.is(count, 1);
});

test('countLock() returns the correct number of locks', async (t) => {
  const { bucket, providerName } = t.context;

  const count = await lock.__with__('listS3ObjectsV2', () => Promise.resolve([
    {
      Key: `lock/${providerName}/test`,
      LastModified: Date.now()
    },
    {
      Key: `lock/${providerName}/test2`,
      LastModified: Date.now() - (fiveMinutes + 1)
    }
  ]))(() => countLock(bucket, providerName));
  t.is(count, 1);
});

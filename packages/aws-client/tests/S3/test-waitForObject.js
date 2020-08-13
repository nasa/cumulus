'use strict';

const test = require('ava');
const { waitForObject } = require('../../S3');

test('waitForObject() returns the requested object', async (t) => {
  const Bucket = 'my-bucket';
  const Key = 'my-key';

  const s3Client = {
    getObject: (params) => {
      t.is(params.Bucket, Bucket);
      t.is(params.Key, Key);

      return {
        promise: async () => 'asdf',
      };
    },
  };

  const result = await waitForObject(s3Client, { Bucket, Key });

  t.is(result, 'asdf');
});

test('waitForObject() does not retry if the requested bucket does not exist', async (t) => {
  const Bucket = 'my-bucket';
  const Key = 'my-key';

  let callCount = 0;

  const s3Client = {
    getObject: (params) => {
      t.is(params.Bucket, Bucket);
      t.is(params.Key, Key);

      callCount += 1;

      const error = new Error('Bucket does not exist');
      error.code = 'NoSuchBucket';

      return { promise: () => Promise.reject(error) };
    },
  };

  await t.throwsAsync(
    waitForObject(
      s3Client,
      { Bucket, Key },
      { minTimeout: 1, retries: 1 }
    ),
    { message: 'Bucket does not exist' }
  );

  t.is(callCount, 1);
});

test('waitForObject() retries if the requested object does not exist', async (t) => {
  const Bucket = 'my-bucket';
  const Key = 'my-key';

  let callCount = 0;

  const s3Client = {
    getObject: (params) => {
      t.is(params.Bucket, Bucket);
      t.is(params.Key, Key);

      callCount += 1;

      if (callCount === 1) {
        const error = new Error('Object does not exist');
        error.code = 'NoSuchKey';

        return { promise: () => Promise.reject(error) };
      }

      return { promise: () => Promise.resolve('asdf') };
    },
  };

  const result = await waitForObject(
    s3Client,
    { Bucket, Key },
    { minTimeout: 1, retries: 1 }
  );

  t.is(callCount, 2);
  t.is(result, 'asdf');
});

test('waitForObject() retries if the wrong etag was returned', async (t) => {
  const Bucket = 'my-bucket';
  const Key = 'my-key';

  let callCount = 0;

  const s3Client = {
    getObject: (params) => {
      t.is(params.Bucket, Bucket);
      t.is(params.Key, Key);

      callCount += 1;

      if (callCount === 1) {
        const error = new Error('Incorrect etag');
        error.code = 'PreconditionFailed';

        return { promise: () => Promise.reject(error) };
      }

      return { promise: () => Promise.resolve('asdf') };
    },
  };

  const result = await waitForObject(
    s3Client,
    { Bucket, Key, IfMatch: 'some-etag' },
    { minTimeout: 1, retries: 1 }
  );

  t.is(callCount, 2);
  t.is(result, 'asdf');
});

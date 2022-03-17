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

      return Promise.resolve('asdf');
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
      error.name = 'NoSuchBucket';

      return Promise.reject(error);
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
        error.name = 'NoSuchKey';

        return Promise.reject(error);
      }

      return Promise.resolve('asdf');
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
        error.name = 'PreconditionFailed';

        return Promise.reject(error);
      }

      return Promise.resolve('asdf');
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

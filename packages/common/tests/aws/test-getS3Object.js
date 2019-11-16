'use strict';

const test = require('ava');
const pTimeout = require('p-timeout');
const { getS3Object, recursivelyDeleteS3Bucket, s3 } = require('../../aws');
const { randomString } = require('../../test-utils');
const { sleep } = require('../../util');

test.before(async (t) => {
  t.context.Bucket = randomString();

  await s3().createBucket({ Bucket: t.context.Bucket }).promise();
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.Bucket);
});

test('getS3Object() returns an existing S3 object', async (t) => {
  const { Bucket } = t.context;
  const Key = randomString();

  await s3().putObject({ Bucket, Key, Body: 'asdf' }).promise();

  const response = await getS3Object(Bucket, Key);
  t.is(response.Body.toString(), 'asdf');
});

test('getS3Object() immediately throws an exception if the requested bucket does not exist', async (t) => {
  const promisedGetS3Object = getS3Object(randomString(), 'asdf');
  const err = await t.throwsAsync(pTimeout(promisedGetS3Object, 5000));
  t.is(err.code, 'NoSuchBucket');
});

test('getS3Object() throws an exception if the requested key does not exist', async (t) => {
  const { Bucket } = t.context;

  const err = await t.throwsAsync(
    () => getS3Object(Bucket, 'does-not-exist', { retries: 1 })
  );
  t.is(err.code, 'NoSuchKey');
});

test('getS3Object() immediately throws an exception if the requested key does not exist', async (t) => {
  const { Bucket } = t.context;

  const promisedGetS3Object = getS3Object(Bucket, 'asdf');

  const err = await t.throwsAsync(pTimeout(promisedGetS3Object, 5000));

  t.is(err.code, 'NoSuchKey');
});

test('getS3Object() will retry if the requested key does not exist', async (t) => {
  const { Bucket } = t.context;
  const Key = randomString();

  const promisedGetS3Object = getS3Object(Bucket, Key, { retries: 5 });
  await sleep(3000)
    .then(() => s3().putObject({ Bucket, Key, Body: 'asdf' }).promise());

  const response = await promisedGetS3Object;

  t.is(response.Body.toString(), 'asdf');
});

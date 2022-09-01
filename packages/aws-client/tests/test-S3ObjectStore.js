const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const got = require('got');
const { s3 } = require('../services');
const { createBucket, recursivelyDeleteS3Bucket } = require('../S3');
const S3ObjectStore = require('../S3ObjectStore');
const { streamToString } = require('../test-utils');

const randomString = () => cryptoRandomString({ length: 10 });

const stageTestObjectToLocalStack = (bucket, body, key = randomString()) =>
  s3().putObject({ Bucket: bucket, Key: key, Body: body })
    .then(({ ETag }) => ({ ETag, Key: key }));

test.before(async (t) => {
  t.context.Bucket = randomString();

  await createBucket(t.context.Bucket);
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.Bucket);
});

test('S3ObjectStore.signGetObject returns a signed url', async (t) => {
  const store = new S3ObjectStore();
  const { Bucket } = t.context;
  const { Key } = await stageTestObjectToLocalStack(Bucket, 'asdf');
  const signedUrl = await store.signGetObject(`s3://${Bucket}/${Key}`);
  t.regex(signedUrl, new RegExp(`${Bucket}/${Key}?.*X-Amz-Algorithm.*X-Amz-Credential.*X-Amz-Date.*X-Amz-Expires.*X-Amz-Signature.*X-Amz-SignedHeaders.*`));
  const stream = await got.stream(signedUrl);
  const downloaded = await streamToString(stream);
  t.is(downloaded, 'asdf');
});

test('S3ObjectStore.signHeadObject() returns a signed url', async (t) => {
  const store = new S3ObjectStore();
  const { Bucket } = t.context;
  const { Key } = await stageTestObjectToLocalStack(Bucket, 'asdf');
  const signedUrl = await store.signHeadObject(`s3://${Bucket}/${Key}`);
  t.regex(signedUrl, new RegExp(`${Bucket}/${Key}?.*X-Amz-Algorithm.*X-Amz-Credential.*X-Amz-Date.*X-Amz-Expires.*X-Amz-Signature.*X-Amz-SignedHeaders.*`));
});

test('S3ObjectStore.signGetObject returns a signed url with params and expiration time', async (t) => {
  const store = new S3ObjectStore();
  const { Bucket } = t.context;
  const { Key } = await stageTestObjectToLocalStack(Bucket, 'asdf');
  const signedUrl = await store.signGetObject(`s3://${Bucket}/${Key}`, {}, { 'A-userid': 'joe' }, { expiresIn: 1000 });
  t.regex(signedUrl, new RegExp(`${Bucket}/${Key}?.*A-userid=joe.*X-Amz-Algorithm.*X-Amz-Credential.*X-Amz-Date.*X-Amz-Expires=1000&X-Amz-Signature.*X-Amz-SignedHeaders.*`));
  const stream = await got.stream(signedUrl);
  const downloaded = await streamToString(stream);
  t.is(downloaded, 'asdf');
});

test('S3ObjectStore.signHeadObject() returns a signed url with params and expiration time', async (t) => {
  const store = new S3ObjectStore();
  const { Bucket } = t.context;
  const { Key } = await stageTestObjectToLocalStack(Bucket, 'asdf');
  const signedUrl = await store.signHeadObject(`s3://${Bucket}/${Key}`, {}, { 'A-userid': 'user' }, { expiresIn: 1000 });
  t.regex(signedUrl, new RegExp(`${Bucket}/${Key}?.*A-userid=user.*X-Amz-Algorithm.*X-Amz-Credential.*X-Amz-Date.*X-Amz-Expires=1000&X-Amz-Signature.*X-Amz-SignedHeaders.*`));
});

test('S3ObjectStore.signGetObject throws TypeError when URL is not valid', async (t) => {
  const store = new S3ObjectStore();
  await t.throwsAsync(
    store.signGetObject('http://example.com'),
    { instanceOf: TypeError }
  );
});

test('S3ObjectStore.signGetObject throws NotFound when object is not found', async (t) => {
  const store = new S3ObjectStore();
  const { Bucket } = t.context;
  const Key = randomString();
  await t.throwsAsync(
    store.signGetObject(`s3://${Bucket}/${Key}`),
    { name: 'NotFound' }
  );
});

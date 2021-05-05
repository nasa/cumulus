const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const { s3 } = require('../services');
const { createBucket, recursivelyDeleteS3Bucket } = require('../S3');
const S3ObjectStore = require('../S3ObjectStore');

const randomString = () => cryptoRandomString({ length: 10 });

const stageTestObjectToLocalStack = (bucket, body, key = randomString()) =>
  s3().putObject({ Bucket: bucket, Key: key, Body: body })
    .promise()
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
  t.regex(signedUrl, new RegExp(`${Bucket}/${Key}?.*AWSAccessKeyId.*Expires.*Signature.*`));
});

test('S3ObjectStore.signGetObject returns a signed url with params', async (t) => {
  const store = new S3ObjectStore();
  const { Bucket } = t.context;
  const { Key } = await stageTestObjectToLocalStack(Bucket, 'asdf');
  const signedUrl = await store.signGetObject(`s3://${Bucket}/${Key}`, { 'A-userid': 'joe' });
  t.regex(signedUrl, new RegExp(`${Bucket}/${Key}?.*A-userid=joe.*AWSAccessKeyId.*Expires.*Signature.*`));
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
    { code: 'NotFound' }
  );
});

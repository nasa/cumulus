const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const { defaultObjectStore, objectStoreForProtocol, S3ObjectStore } = require('../S3ObjectStore');
const { createBucket, recursivelyDeleteS3Bucket } = require('../S3');
const { s3 } = require('../services');

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

test('objectStoreForProtocol returns null when no protocol is supplied', (t) => {
  t.is(objectStoreForProtocol(), undefined);
});

test('objectStoreForProtocol returns null when an unrecognized protocol is supplied', (t) => {
  t.is(objectStoreForProtocol('azure'), undefined);
});

test('objectStoreForProtocol returns an S3ObjectStore when "s3" is supplied as the protocol', (t) => {
  t.true(objectStoreForProtocol('s3') instanceof S3ObjectStore);
});

test('objectStoreForProtocol ignores trailing colons on the protocol', (t) => {
  t.true(objectStoreForProtocol('s3:') instanceof S3ObjectStore);
});

test('defaultObjectStore returns an S3 object store', (t) => {
  t.true(defaultObjectStore() instanceof S3ObjectStore);
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

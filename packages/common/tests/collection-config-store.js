'use strict';

const test = require('ava');
const { recursivelyDeleteS3Bucket, s3 } = require('../aws');
const { randomString } = require('../test-utils');
const CollectionConfigStore = require('../collection-config-store');

test.beforeEach(async (t) => {
  t.context.stackName = randomString();
  t.context.dataType = randomString();
  t.context.collectionConfig = { name: randomString() };

  t.context.bucket = randomString();
  await s3().createBucket({ Bucket: t.context.bucket }).promise();

  // Utility function to return the S3 key of a collection config
  t.context.collectionConfigKey = (dataType) =>
    `${t.context.stackName}/collections/${dataType}.json`;
});

test.afterEach(async (t) => {
  try {
    await recursivelyDeleteS3Bucket(t.context.bucket);
  }
  catch (err) {
    // Some tests delete the bucket before this "afterEach" hook is run
    if (err.code !== 'NoSuchBucket') throw err;
  }
});

test('get() fetches a collection config from S3', async (t) => {
  await s3().putObject({
    Bucket: t.context.bucket,
    Key: t.context.collectionConfigKey(t.context.dataType),
    Body: JSON.stringify(t.context.collectionConfig)
  }).promise();

  const collectionConfigStore = new CollectionConfigStore(t.context.bucket, t.context.stackName);
  const fetchedCollectionConfig = await collectionConfigStore.get(t.context.dataType);

  t.deepEqual(fetchedCollectionConfig, t.context.collectionConfig);
});

test('get() does not hit S3 for a cached collection config', async (t) => {
  await s3().putObject({
    Bucket: t.context.bucket,
    Key: t.context.collectionConfigKey(t.context.dataType),
    Body: JSON.stringify(t.context.collectionConfig)
  }).promise();

  const collectionConfigStore = new CollectionConfigStore(t.context.bucket, t.context.stackName);

  // Fetch the collection config once so it's in the cache
  await collectionConfigStore.get(t.context.dataType);

  // Delete the S3 bucket so the config can't be fetched from S3
  await recursivelyDeleteS3Bucket(t.context.bucket);

  // This get() should use the cache
  const fetchedCollectionConfig = await collectionConfigStore.get(t.context.dataType);

  t.deepEqual(fetchedCollectionConfig, t.context.collectionConfig);
});

test('get() throws an exception if the collection config could not be found', async (t) => {
  const invalidDataType = randomString();
  const collectionConfigStore = new CollectionConfigStore(t.context.bucket, t.context.stackName);

  try {
    await collectionConfigStore.get(invalidDataType);
    t.fail('Expected an error to be thrown');
  }
  catch (err) {
    t.is(err.message, `A collection config for data type "${invalidDataType}" was not found.`);
  }
});

test('get() throws an exception if the bucket does not exist', async (t) => {
  const invalidBucket = randomString();
  const collectionConfigStore = new CollectionConfigStore(invalidBucket, t.context.stackName);

  try {
    await collectionConfigStore.get(t.context.dataType);
    t.fail('Expected an error to be thrown');
  }
  catch (err) {
    t.is(err.message, `Collection config bucket does not exist: ${invalidBucket}`);
  }
});

test('put() stores a collection config to S3', async (t) => {
  const collectionConfigStore = new CollectionConfigStore(t.context.bucket, t.context.stackName);
  await collectionConfigStore.put(t.context.dataType, t.context.collectionConfig);

  const getObjectResponse = await s3().getObject({
    Bucket: t.context.bucket,
    Key: t.context.collectionConfigKey(t.context.dataType)
  }).promise();

  const storedCollectionConfig = JSON.parse(getObjectResponse.Body.toString());
  t.deepEqual(storedCollectionConfig, t.context.collectionConfig);
});

test('put() updates the cache with the new collection config', async (t) => {
  const collectionConfigStore = new CollectionConfigStore(t.context.bucket, t.context.stackName);
  await collectionConfigStore.put(t.context.dataType, t.context.collectionConfig);

  // Delete the S3 bucket so the config can't be fetched from S3
  await recursivelyDeleteS3Bucket(t.context.bucket);

  // This get() should use the cache
  const fetchedCollectionConfig = await collectionConfigStore.get(t.context.dataType);

  t.deepEqual(fetchedCollectionConfig, t.context.collectionConfig);
});

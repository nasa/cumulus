'use strict';

const test = require('ava');
const { recursivelyDeleteS3Bucket, s3, s3ObjectExists } = require('../aws');
const { randomString } = require('../test-utils');
const {
  CollectionConfigStore,
  constructCollectionId
} = require('../collection-config-store');

test.beforeEach(async (t) => {
  t.context.stackName = randomString();
  t.context.dataType = randomString();
  t.context.dataVersion = '6';
  t.context.collectionConfig = { name: randomString() };
  t.context.bucket = randomString();
  // Utility function to return the S3 key of a collection config
  t.context.collectionConfigKey = (dataType, dataVersion) => {
    const collectionId = constructCollectionId(dataType, dataVersion);
    return `${t.context.stackName}/collections/${collectionId}.json`;
  };

  await s3().createBucket({ Bucket: t.context.bucket }).promise();
});

test.afterEach((t) =>
  recursivelyDeleteS3Bucket(t.context.bucket)
    .catch((err) => {
      // Some tests delete the bucket before this "afterEach" hook is run,
      // which is okay.
      if (err.code !== 'NoSuchBucket') throw err;
    }));

test.serial('get() fetches a collection config from S3', async (t) => {
  const {
    bucket,
    collectionConfig,
    collectionConfigKey,
    dataType,
    dataVersion,
    stackName
  } = t.context;

  await s3().putObject({
    Bucket: bucket,
    Key: collectionConfigKey(dataType, dataVersion),
    Body: JSON.stringify(collectionConfig)
  }).promise();

  const collectionConfigStore = new CollectionConfigStore(bucket, stackName);
  const fetchedCollectionConfig = await collectionConfigStore.get(dataType,
    dataVersion);

  t.deepEqual(fetchedCollectionConfig, collectionConfig);
});

test.serial('get() does not hit S3 for a cached collection config', async (t) => {
  const {
    bucket,
    collectionConfig,
    collectionConfigKey,
    dataType,
    dataVersion,
    stackName
  } = t.context;

  await s3().putObject({
    Bucket: bucket,
    Key: collectionConfigKey(dataType, dataVersion),
    Body: JSON.stringify(collectionConfig)
  }).promise();

  const collectionConfigStore = new CollectionConfigStore(bucket, stackName);

  // Fetch the collection config once so it's in the cache
  await collectionConfigStore.get(dataType, dataVersion);

  // Delete the S3 bucket so the config can't be fetched from S3
  await recursivelyDeleteS3Bucket(bucket);

  // This get() should use the cache
  const fetchedCollectionConfig = await collectionConfigStore.get(dataType,
    dataVersion);

  t.deepEqual(fetchedCollectionConfig, collectionConfig);
});

test.serial('get() throws an exception if the collection config could not be found', async (t) => {
  const { bucket, dataVersion, stackName } = t.context;
  const invalidDataType = randomString();
  const collectionConfigStore = new CollectionConfigStore(bucket, stackName);
  const collectionId = constructCollectionId(invalidDataType, dataVersion);

  await t.throwsAsync(
    async () => collectionConfigStore.get(invalidDataType, dataVersion),
    { message: new RegExp(`${collectionId}`) }
  );
});

test.serial('get() throws an exception if the bucket does not exist', async (t) => {
  const { dataType, dataVersion, stackName } = t.context;
  const invalidBucket = randomString();
  const collectionConfigStore = new CollectionConfigStore(invalidBucket,
    stackName);

  await t.throwsAsync(
    async () => collectionConfigStore.get(dataType, dataVersion),
    { message: new RegExp(`${invalidBucket}`) }
  );
});

test.serial('put() stores a collection config to S3', async (t) => {
  const {
    bucket,
    collectionConfig,
    collectionConfigKey,
    dataType,
    dataVersion,
    stackName
  } = t.context;
  const collectionConfigStore = new CollectionConfigStore(bucket, stackName);
  await collectionConfigStore.put(dataType, dataVersion, collectionConfig);

  const getObjectResponse = await s3().getObject({
    Bucket: bucket,
    Key: collectionConfigKey(dataType, dataVersion)
  }).promise();

  const storedCollectionConfig = JSON.parse(getObjectResponse.Body.toString());
  t.deepEqual(storedCollectionConfig, collectionConfig);
});

test.serial('put() updates the cache with the new collection config', async (t) => {
  const {
    bucket,
    dataType,
    dataVersion,
    collectionConfig,
    stackName
  } = t.context;
  const collectionConfigStore = new CollectionConfigStore(bucket, stackName);

  await collectionConfigStore.put(dataType, dataVersion, collectionConfig);

  // Delete the S3 bucket so the config can't be fetched from S3
  await recursivelyDeleteS3Bucket(bucket);

  // This get() should use the cache
  const fetchedCollectionConfig = await collectionConfigStore.get(dataType,
    dataVersion);

  t.deepEqual(fetchedCollectionConfig, collectionConfig);
});

test.serial('delete() removes the collection config from S3', async (t) => {
  const {
    bucket,
    collectionConfig,
    collectionConfigKey,
    dataType,
    dataVersion,
    stackName
  } = t.context;
  const key = collectionConfigKey(dataType, dataVersion);
  const s3Object = { Bucket: bucket, Key: key };
  const collectionConfigStore = new CollectionConfigStore(bucket, stackName);

  // Store the collection config to S3
  await collectionConfigStore.put(dataType, dataVersion, collectionConfig);

  // Verify that the collection config is in S3.  Will throw an error
  t.true(await s3ObjectExists(s3Object));

  // Delete the collection config
  await collectionConfigStore.delete(dataType, dataVersion);

  // Verify that the collection config is no longer in S3
  t.false(await s3ObjectExists(s3Object));
});

test('delete() the collection config from the cache', async (t) => {
  const {
    bucket,
    collectionConfig,
    dataType,
    dataVersion,
    stackName
  } = t.context;
  const collectionConfigStore = new CollectionConfigStore(bucket, stackName);

  // Store the collection config to S3, which will also cache it
  await collectionConfigStore.put(dataType, dataVersion, collectionConfig);

  // Delete the collection config, which should clear it from the cache
  await collectionConfigStore.delete(dataType, dataVersion);

  // Try to get the config, which should hit S3 and fail if it isn't cached
  await t.throwsAsync(
    async () => collectionConfigStore.get(dataType, dataVersion),
    { message: new RegExp(`${constructCollectionId(dataType, dataVersion)}`) }
  );
});

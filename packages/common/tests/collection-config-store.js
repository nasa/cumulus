'use strict';

const test = require('ava');
const { recursivelyDeleteS3Bucket, s3, s3ObjectExists } = require('../aws');
const { randomString } = require('../test-utils');
const { CollectionConfigStore } = require('../collection-config-store');

test.beforeEach(async (t) => {
  t.context.stackName = randomString();
  t.context.dataType = randomString();
  t.context.dataVersion = '6';

  t.context.collectionConfig = { name: randomString() };

  t.context.bucket = randomString();
  await s3().createBucket({ Bucket: t.context.bucket }).promise();

  // Utility function to return the S3 key of a collection config
  t.context.collectionConfigKey = (dataType, dataVersion) =>
    `${t.context.stackName}/collections/${dataType}___${dataVersion}.json`;
});

test.afterEach((t) =>
  recursivelyDeleteS3Bucket(t.context.bucket)
    .catch((err) => {
      // Some tests delete the bucket before this "afterEach" hook is run,
      // which is okay.
      if (err.code !== 'NoSuchBucket') throw err;
    }));

test.serial('get() fetches a collection config from S3', async (t) => {
  await s3().putObject({
    Bucket: t.context.bucket,
    Key: t.context.collectionConfigKey(t.context.dataType, t.context.dataVersion),
    Body: JSON.stringify(t.context.collectionConfig)
  }).promise();

  const collectionConfigStore = new CollectionConfigStore(t.context.bucket, t.context.stackName);
  const fetchedCollectionConfig = await collectionConfigStore.get(
    t.context.dataType,
    t.context.dataVersion
  );

  t.deepEqual(fetchedCollectionConfig, t.context.collectionConfig);
});

test.serial('get() does not hit S3 for a cached collection config', async (t) => {
  await s3().putObject({
    Bucket: t.context.bucket,
    Key: t.context.collectionConfigKey(t.context.dataType, t.context.dataVersion),
    Body: JSON.stringify(t.context.collectionConfig)
  }).promise();

  const collectionConfigStore = new CollectionConfigStore(t.context.bucket, t.context.stackName);

  // Fetch the collection config once so it's in the cache
  await collectionConfigStore.get(t.context.dataType, t.context.dataVersion);

  // Delete the S3 bucket so the config can't be fetched from S3
  await recursivelyDeleteS3Bucket(t.context.bucket);

  // This get() should use the cache
  const fetchedCollectionConfig = await collectionConfigStore.get(
    t.context.dataType,
    t.context.dataVersion
  );

  t.deepEqual(fetchedCollectionConfig, t.context.collectionConfig);
});

test.serial('get() throws an exception if the collection config could not be found', async (t) => {
  const invalidDataType = randomString();
  const collectionConfigStore = new CollectionConfigStore(t.context.bucket, t.context.stackName);

  try {
    await collectionConfigStore.get(invalidDataType, t.context.dataVersion);
    t.fail('Expected an error to be thrown');
  } catch (err) {
    t.is(err.message, `A collection config for data type "${invalidDataType}__${t.context.dataVersion}" was not found.`);
  }
});

test.serial('get() throws an exception if the bucket does not exist', async (t) => {
  const invalidBucket = randomString();
  const collectionConfigStore = new CollectionConfigStore(invalidBucket, t.context.stackName);

  try {
    await collectionConfigStore.get(t.context.dataType, t.context.dataVersion);
    t.fail('Expected an error to be thrown');
  } catch (err) {
    t.is(err.message, `Collection config bucket does not exist: ${invalidBucket}`);
  }
});

test.serial('put() stores a collection config to S3', async (t) => {
  const collectionConfigStore = new CollectionConfigStore(t.context.bucket, t.context.stackName);
  await collectionConfigStore.put(
    t.context.dataType,
    t.context.dataVersion,
    t.context.collectionConfig
  );

  const getObjectResponse = await s3().getObject({
    Bucket: t.context.bucket,
    Key: t.context.collectionConfigKey(t.context.dataType, t.context.dataVersion)
  }).promise();

  const storedCollectionConfig = JSON.parse(getObjectResponse.Body.toString());
  t.deepEqual(storedCollectionConfig, t.context.collectionConfig);
});

test.serial('put() updates the cache with the new collection config', async (t) => {
  const collectionConfigStore = new CollectionConfigStore(t.context.bucket, t.context.stackName);

  const { dataType, dataVersion, collectionConfig } = t.context;

  await collectionConfigStore.put(dataType, dataVersion, collectionConfig);

  // Delete the S3 bucket so the config can't be fetched from S3
  await recursivelyDeleteS3Bucket(t.context.bucket);

  // This get() should use the cache
  const fetchedCollectionConfig = await collectionConfigStore.get(
    dataType,
    dataVersion
  );

  t.deepEqual(fetchedCollectionConfig, collectionConfig);
});

test.serial('delete() removes the collection config from S3', async (t) => {
  const bucket = t.context.bucket;
  const collectionConfigKey = t.context.collectionConfigKey(
    t.context.dataType,
    t.context.dataVersion
  );

  // Store the collection config to S3
  await (new CollectionConfigStore(bucket, t.context.stackName))
    .put(t.context.dataType, t.context.dataVersion, t.context.collectionConfig);

  // Verify that the collection config is in S3.  Will throw an error
  t.true(await s3ObjectExists({ Bucket: bucket, Key: collectionConfigKey }));

  // Delete the collection config
  await (new CollectionConfigStore(bucket, t.context.stackName))
    .delete(t.context.dataType, t.context.dataVersion);

  // Verify that the collection config is no longer in S3
  t.false(await s3ObjectExists({ Bucket: bucket, Key: collectionConfigKey }));
});

test('delete() the collection config from the cache', async (t) => {
  const collectionConfigStore = new CollectionConfigStore(t.context.bucket, t.context.stackName);

  // Store the collection config to S3, which will also cache it
  await collectionConfigStore.put(
    t.context.dataType,
    t.context.dataVersion,
    t.context.collectionConfig
  );

  // Delete the collection config, which should clear it from the cache
  await collectionConfigStore.delete(t.context.dataType, t.context.dataVersion);

  // Try to get the config, which should hit S3 and fail if it isn't cached
  try {
    await collectionConfigStore.get(t.context.dataType, t.context.dataVersion);
    t.fail('Expected an error to be thrown');
  } catch (err) {
    t.is(err.message, `A collection config for data type "${t.context.dataType}__${t.context.dataVersion}" was not found.`);
  }
});

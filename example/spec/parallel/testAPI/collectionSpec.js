'use strict';

const { deleteS3Object, getJsonS3Object, waitForObjectToExist } = require('@cumulus/aws-client/S3');
const { fakeCollectionFactory } = require('@cumulus/api/lib/testUtils');
const { createCollection, deleteCollection, getCollection, updateCollection } = require('@cumulus/api-client/collections');

const { loadConfig } = require('../../helpers/testUtils');

describe('Collections API', () => {
  let beforeAllFailed = false;
  let config;
  let collection;
  let originalCollectionFromApi;
  let prefix;
  let recordCreatedKey;
  let recordUpdatedKey;
  let recordDeletedKey;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      prefix = config.stackName;

      collection = fakeCollectionFactory({ reportToEms: true });
      await createCollection({ prefix, collection });
      const { name, version } = collection;
      originalCollectionFromApi = await getCollection({
        prefix: config.stackName,
        collectionName: collection.name,
        collectionVersion: collection.version,
      });

      const reportKeyPrefix = `${config.stackName}/test-output`;
      recordCreatedKey = `${reportKeyPrefix}/${name}-${version}-Create.output`;
      recordUpdatedKey = `${reportKeyPrefix}/${name}-${version}-Update.output`;
      recordDeletedKey = `${reportKeyPrefix}/${name}-${version}-Delete.output`;
    } catch (error) {
      beforeAllFailed = true;
      console.log(error);
    }
  });

  afterAll(async () => {
    await Promise.all([
      deleteS3Object(config.bucket, recordCreatedKey),
      deleteS3Object(config.bucket, recordUpdatedKey),
      deleteS3Object(config.bucket, recordDeletedKey),
    ]);
  });

  it('creating a collection publishes a record to the collection reporting SNS topic', async () => {
    if (beforeAllFailed) {
      fail('beforeAll() failed');
    } else {
      await expectAsync(waitForObjectToExist({
        bucket: config.bucket,
        key: recordCreatedKey,
      })).toBeResolved();
      const savedEvent = await getJsonS3Object(config.bucket, recordCreatedKey);
      const message = JSON.parse(savedEvent.Records[0].Sns.Message);
      expect(message.event).toEqual('Create');
      expect(message.record).toEqual(originalCollectionFromApi);
    }
  });

  it('updating a collection publishes a record to the collection reporting SNS topic', async () => {
    if (beforeAllFailed) {
      fail('beforeAll() failed');
    } else {
      const updatedCollection = {
        ...collection,
        reportToEms: false,
      };
      expect(originalCollectionFromApi.reportToEms).toEqual(true);

      await updateCollection({
        prefix: config.stackName,
        collection: updatedCollection,
      });
      const updatedCollectionFromApi = await getCollection({
        prefix: config.stackName,
        collectionName: updatedCollection.name,
        collectionVersion: updatedCollection.version,
      });

      await expectAsync(waitForObjectToExist({
        bucket: config.bucket,
        key: recordUpdatedKey,
      })).toBeResolved();
      const savedEvent = await getJsonS3Object(config.bucket, recordUpdatedKey);
      const message = JSON.parse(savedEvent.Records[0].Sns.Message);
      expect(message.event).toEqual('Update');
      expect(message.record).toEqual(updatedCollectionFromApi);
      expect(message.record.reportToEms).toEqual(false);
    }
  });

  it('deleting a collection publishes a record to the collection reporting SNS topic', async () => {
    if (beforeAllFailed) {
      fail('beforeAll() failed');
    } else {
      const timestamp = Date.now();
      await deleteCollection({
        prefix,
        collectionName: collection.name,
        collectionVersion: collection.version,
      });

      await expectAsync(waitForObjectToExist({
        bucket: config.bucket,
        key: recordDeletedKey,
      })).toBeResolved();
      const savedEvent = await getJsonS3Object(config.bucket, recordDeletedKey);
      const message = JSON.parse(savedEvent.Records[0].Sns.Message);
      expect(message.event).toEqual('Delete');
      expect(message.record).toEqual({ name: collection.name, version: collection.version });
      expect(message.deletedAt).toBeGreaterThan(timestamp);
    }
  });
});

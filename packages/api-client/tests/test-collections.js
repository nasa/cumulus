'use strict';

const test = require('ava');

const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');

const collectionsApi = require('../collections');
const { fakeCollectionFactory } = require('../../api/lib/testUtils');
const { Collection } = require('../../api/models');
const { randomId, randomString } = require('../../common/test-utils');

test.before(async (t) => {
  process.env.stackName = randomString();
  process.env.system_bucket = randomString();
  t.context.testPrefix = 'unitTestStack';
  t.context.collectionName = 'testCollection';
  t.context.collectionVersion = 1;

  // create a fake bucket
  await createBucket(process.env.system_bucket);

  process.env.CollectionsTable = randomId('collection');
  t.context.collectionModel = new Collection();
  await t.context.collectionModel.createTable();
});

test.after.always(async (t) => {
  await t.context.collectionModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test('deleteCollection calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/collections/${t.context.collectionName}/${t.context.collectionVersion}`,
    },
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };

  await t.notThrowsAsync(collectionsApi.deleteCollection({
    callback,
    prefix: t.context.testPrefix,
    collectionName: t.context.collectionName,
    collectionVersion: t.context.collectionVersion,
  }));
});

test('createCollection calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: { 'Content-Type': 'application/json' },
      path: '/collections',
      body: JSON.stringify(t.context.collection),
    },
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };
  await t.notThrowsAsync(collectionsApi.createCollection({
    callback,
    prefix: t.context.testPrefix,
    collectionName: t.context.collectionName,
  }));
});

test('getCollection calls the callback with the expected object and returns the parsed response', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/collections/${t.context.collectionName}/${t.context.collectionVersion}`,
    },
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
    return Promise.resolve({ body: '{ "foo": "bar" }' });
  };

  const result = await collectionsApi.getCollection({
    callback,
    prefix: t.context.testPrefix,
    collectionName: t.context.collectionName,
    collectionVersion: t.context.collectionVersion,
  });

  t.deepEqual(result, { foo: 'bar' });
});

test('getCollections calls the callback with the expected object and returns the parsed response', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/collections/',
      queryStringParameters: undefined,
    },
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
    return Promise.resolve({ foo: 'bar' });
  };

  const result = await collectionsApi.getCollections({
    callback,
    prefix: t.context.testPrefix,
  });

  t.deepEqual(result, { foo: 'bar' });
});

test('updateCollection calls the callback with the expected object', async (t) => {
  const collection = fakeCollectionFactory();

  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      headers: { 'Content-Type': 'application/json' },
      path: `/collections/${collection.name}/${collection.version}`,
      body: JSON.stringify(collection),
    },
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };
  await t.notThrowsAsync(collectionsApi.updateCollection({
    callback,
    prefix: t.context.testPrefix,
    collection,
  }));
});

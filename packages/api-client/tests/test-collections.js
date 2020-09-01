'use strict';

const test = require('ava');
const collectionsApi = require('../collections');

test.before(async (t) => {
  t.context.testPrefix = 'unitTestStack';
  t.context.collectionName = 'testCollection';
  t.context.collectionVersion = 1;
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

  const callback = async (configObject) => {
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

  const callback = async (configObject) => {
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

  const callback = async (configObject) => {
    t.deepEqual(expected, configObject);
    return { body: '{ "foo": "bar" }' };
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
      queryStringParameters: undefined,
      path: '/collections/',
      queryStringParameters: undefined,
    },
  };

  const callback = async (configObject) => {
    t.deepEqual(expected, configObject);
    return { foo: 'bar' };
  };

  const result = await collectionsApi.getCollections({
    callback,
    prefix: t.context.testPrefix,
  });

  t.deepEqual(result, { foo: 'bar' });
});

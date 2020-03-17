'use strict';

const test = require('ava');
const rewire = require('rewire');
const collectionsRewire = rewire('../collections');

test.before(async (t) => {
  t.context.testPrefix = 'unitTestStack';
  t.context.collection = 'collection';
  t.context.collectionVersion = 1;
});

test('deleteCollection calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/collections/${t.context.collection }/${t.context.collectionVersion}`
    }
  };

  const callback = async (configObject) => {
    t.deepEqual(expected, configObject);
  };

  await t.notThrowsAsync(collectionsRewire.deleteCollection(
    t.context.testPrefix,
    t.context.collection,
    t.context.collectionVersion,
    callback
  ));
});

test('createCollection calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: { 'Content-Type': 'application/json' },
      path: '/collections',
      body: JSON.stringify(t.context.collection)
    }
  };

  const callback = async (configObject) => {
    t.deepEqual(expected, configObject);
  };

  await t.notThrowsAsync(collectionsRewire.createCollection(
    t.context.testPrefix,
    t.context.collection,
    callback
  ));
});

test('getCollection calls the callback with the expected object and returns the parsed response', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/collections/${t.context.collection}/${t.context.collectionVersion}`
    }
  };

  const callback = async (configObject) => {
    t.deepEqual(expected, configObject);
    return { body: '{ "foo": "bar" }' };
  };

  const result = await collectionsRewire.getCollection(
    t.context.testPrefix,
    t.context.collection,
    t.context.collectionVersion,
    callback
  );

  t.deepEqual(result, {foo: 'bar'});
});
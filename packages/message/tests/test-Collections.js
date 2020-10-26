'use strict';

const test = require('ava');

const {
  constructCollectionId,
  getCollectionIdFromMessage,
  getCollectionNameFromMessage,
  getCollectionVersionFromMessage,
  getCollectionInfoFromMessage
} = require('../Collections');

test('getCollectionIdFromMessage returns the correct collection ID', (t) => {
  const name = 'test';
  const version = '001';
  const collectionId = getCollectionIdFromMessage({
    meta: {
      collection: {
        name,
        version,
      },
    },
  });
  t.is(collectionId, constructCollectionId(name, version));
});

test('getCollectionIdFromMessage returns undefined when meta.collection is not set', (t) => {
  t.is(undefined, getCollectionIdFromMessage({}));
});

test('getCollectionNameFromMessage returns correct name', (t) => {
  t.is('collection-name', getCollectionNameFromMessage({
    meta: {
      collection: {
        name: 'collection-name',
      },
    },
  }));
});

test('getCollectionNameFromMessage correctly returns undefined', (t) => {
  t.is(undefined, getCollectionNameFromMessage({}));
});

test('getCollectionVersionFromMessage returns correct name', (t) => {
  t.is('x.x.x', getCollectionVersionFromMessage({
    meta: {
      collection: {
        version: 'x.x.x',
      },
    },
  }));
});

test('getCollectionVersionFromMessage correctly returns undefined', (t) => {
  t.is(undefined, getCollectionNameFromMessage({}));
});

test('getCollectionInfoFromMessage returns correct info', (t) => {
  t.deepEqual({
    name: 'collection-name',
    version: 'x.x.x',
  }, getCollectionInfoFromMessage({
    meta: {
      collection: {
        name: 'collection-name',
        version: 'x.x.x',
      },
    },
  }));
});

test('getCollectionInfoFromMessage correctly returns undefined', (t) => {
  t.is(undefined, getCollectionInfoFromMessage({}));
  t.is(undefined, getCollectionInfoFromMessage({
    meta: {
      collection: {
        name: 'name',
      },
    },
  }));
  t.is(undefined, getCollectionInfoFromMessage({
    meta: {
      collection: {
        version: 'version',
      },
    },
  }));
});

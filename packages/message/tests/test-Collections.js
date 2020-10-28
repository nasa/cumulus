'use strict';

const test = require('ava');

const {
  constructCollectionId,
  getCollectionIdFromMessage,
  getCollectionNameAndVersionFromMessage,
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

test('getCollectionNameAndVersionFromMessage returns correct info', (t) => {
  t.deepEqual({
    name: 'collection-name',
    version: 'x.x.x',
  }, getCollectionNameAndVersionFromMessage({
    meta: {
      collection: {
        name: 'collection-name',
        version: 'x.x.x',
      },
    },
  }));
});

test('getCollectionNameAndVersionFromMessage correctly returns undefined', (t) => {
  t.is(undefined, getCollectionNameAndVersionFromMessage({}));
  t.is(undefined, getCollectionNameAndVersionFromMessage({
    meta: {
      collection: {
        name: 'name',
      },
    },
  }));
  t.is(undefined, getCollectionNameAndVersionFromMessage({
    meta: {
      collection: {
        version: 'version',
      },
    },
  }));
});

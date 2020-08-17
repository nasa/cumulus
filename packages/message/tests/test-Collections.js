'use strict';

const test = require('ava');

const {
  constructCollectionId,
  getCollectionIdFromMessage,
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

'use strict';

const test = require('ava');

const {
  constructCollectionId,
  deconstructCollectionId,
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

test('getCollectionIdFromMessage returns the correct collection ID with trailing underscores', (t) => {
  const name = 'test_____';
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

test('constructCollectionId is inverted by deconstructCollectionId', (t) => {
  const collection = {
    name: 'shortname',
    version: 'version',
  };

  const collectionId = constructCollectionId(collection.name, collection.version);
  t.is(collectionId, 'shortname___version');

  const actual = deconstructCollectionId(collectionId);
  t.deepEqual(collection, actual);
});

test('deconstructCollectionId can decode a collection name that contains trailing underscores.', (t) => {
  const collection = {
    name: 'name___',
    version: 'version',
  };
  const collectionId = constructCollectionId(collection.name, collection.version);
  t.is(collectionId, 'name______version');
  const actual = deconstructCollectionId(collectionId);
  t.deepEqual(collection, actual);
});

test('deconstructCollectionId throws error if collectionId is undefined', (t) => {
  t.throws(() => deconstructCollectionId(),
    { message: 'invalid collectionId: undefined' });
});

test('deconstructCollectionId throws error if collectionId is bad', (t) => {
  const badCollectionId = 'anystringwithouttripleunderscores';
  t.throws(() => deconstructCollectionId(badCollectionId),
    { message: `invalid collectionId: ${JSON.stringify(badCollectionId)}` });
});

test('deconstructCollectionId throw error if collectionId is not a string', (t) => {
  const badCollectionId = { some: 'object' };
  t.throws(() => deconstructCollectionId(badCollectionId),
    { message: `invalid collectionId: ${JSON.stringify(badCollectionId)}` });
});

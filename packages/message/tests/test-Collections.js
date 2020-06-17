'use strict';

const test = require('ava');

const {
  constructCollectionId,
  getCollectionIdFromMessage
} = require('../Collections');
const { CumulusMessageError } = require('../errors');

test('getCollectionIdFromMessage returns the correct collection ID', (t) => {
  const name = 'test';
  const version = '001';
  const collectionId = getCollectionIdFromMessage({
    meta: {
      collection: {
        name,
        version
      }
    }
  });
  t.is(collectionId, constructCollectionId(name, version));
});

test('getCollectionIdFromMessage throws CumulusMessageError when meta.collection is not set', (t) => {
  t.throws(() => getCollectionIdFromMessage({}), { instanceOf: CumulusMessageError });
});

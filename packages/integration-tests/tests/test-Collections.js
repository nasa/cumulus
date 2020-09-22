'use strict';

const test = require('ava');
const proxyquire = require('proxyquire');

const fakeApiCollections = {};

const { addCollection } = proxyquire(
  '../Collections',
  {
    '@cumulus/api-client/collections': fakeApiCollections,
  }
);

test('addCollection will throw if CollectionsApi does not return a 200 status code', async (t) => {
  fakeApiCollections.createCollection = async () => ({ statusCode: 500 });
  fakeApiCollections.deleteCollection = async () => Promise.resolve(true);
  await t.throwsAsync(addCollection('bogusStackName', {}));
});

'use strict';

const test = require('ava');
const proxyquire = require('proxyquire');

const fakeApiCollections = {};

const { addCollection, createCollection } = proxyquire(
  '../Collections',
  {
    '@cumulus/api-client/collections': fakeApiCollections,
  }
);

test('addCollection will throw if CollectionsApi does not return a 200 status code', async (t) => {
  fakeApiCollections.createCollection = () => Promise.resolve({ statusCode: 500 });
  fakeApiCollections.deleteCollection = () => Promise.resolve(true);
  await t.throwsAsync(addCollection('bogusStackName', {}));
});

test('createCollection will throw if CollectionsApi does not return a 200 status code', async (t) => {
  fakeApiCollections.createCollection = () => Promise.resolve({ statusCode: 500 });
  await t.throwsAsync(createCollection('bogusStackName', {}));
});

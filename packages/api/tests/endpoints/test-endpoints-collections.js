'use strict';

const sinon = require('sinon');
const test = require('ava');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const models = require('../../models');
const bootstrap = require('../../lambdas/bootstrap');
const collectionsEndpoint = require('../../endpoints/collections');
const EsCollection = require('../../es/collections');
const { testEndpoint, fakeCollectionFactory } = require('../../lib/testUtils');
const { Search } = require('../../es/search');

process.env.CollectionsTable = randomString();
process.env.stackName = randomString();
process.env.internal = randomString();


const collections = new models.Collection();

const testCollection = fakeCollectionFactory();

const hash = { name: 'name', type: 'S' };
const range = { name: 'version', type: 'S' };

const esIndex = randomString();

async function setup() {
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);
  sinon.stub(EsCollection.prototype, 'getStats').returns([testCollection]);
  await aws.s3().createBucket({ Bucket: process.env.internal }).promise();
  await models.Manager.createTable(process.env.CollectionsTable, hash, range);
  await collections.create(testCollection);
}

async function teardown() {
  models.Manager.deleteTable(process.env.CollectionsTable);
  await aws.recursivelyDeleteS3Bucket(process.env.internal);

  const esClient = await Search.es('fakehost');
  await esClient.indices.delete({ index: esIndex });
}

test.before(async () => {
  await setup();
});

test.after.always(async () => {
  await teardown();
});

// TODO(aimee): Debug why this is _passing_ - we don't expect to already have a
// collection in ES.
test('default returns list of collections', (t) => {
  const listEvent = { httpMethod: 'list' };
  return testEndpoint(collectionsEndpoint, listEvent, (response) => {
    const { results } = JSON.parse(response.body);
    t.is(results.length, 1);
  });
});

test('GET returns an existing collection', (t) => {
  const getEvent = {
    httpMethod: 'GET',
    pathParameters: {
      collectionName: testCollection.name,
      version: testCollection.version
    }
  };
  return testEndpoint(collectionsEndpoint, getEvent, (response) => {
    const { name } = JSON.parse(response.body);
    t.is(name, testCollection.name);
  });
});

test('POST creates a new collection', (t) => {
  const newCollection = fakeCollectionFactory();
  const postEvent = {
    httpMethod: 'POST',
    body: JSON.stringify(newCollection)
  };
  return testEndpoint(collectionsEndpoint, postEvent, (response) => {
    const { message, record } = JSON.parse(response.body);
    t.is(message, 'Record saved');
    t.is(record.name, newCollection.name);
  });
});

test('PUT updates an existing collection', (t) => {
  const newPath = '/new_path';
  const updateEvent = {
    body: JSON.stringify({
      name: testCollection.name,
      version: testCollection.version,
      provider_path: newPath
    }),
    pathParameters: {
      collectionName: testCollection.name,
      version: testCollection.version
    },
    httpMethod: 'PUT'
  };
  return testEndpoint(collectionsEndpoint, updateEvent, (response) => {
    const { provider_path } = JSON.parse(response.body); // eslint-disable-line camelcase
    t.is(provider_path, newPath);
  });
});

test('DELETE deletes an existing collection', (t) => {
  const deleteEvent = {
    httpMethod: 'DELETE',
    pathParameters: {
      collectionName: testCollection.name,
      version: testCollection.version
    }
  };
  return testEndpoint(collectionsEndpoint, deleteEvent, (response) => {
    const { message } = JSON.parse(response.body);
    t.is(message, 'Record deleted');
  });
});

test.todo('GET returns existing collection');
test.todo('POST without name and version returns error message');
test.todo('PUT with invalid name and version returns error message');
// Multiple tests
test.todo('Test methods return not found');

'use strict';

const sinon = require('sinon');
const test = require('ava');

process.env.GranulesTable = 'Test_GranulesTable';
process.env.stackName = 'test-stack';
process.env.internal = 'test-bucket';

const models = require('../models');
const aws = require('@cumulus/common/aws');
const bootstrap = require('../lambdas/bootstrap');
const granulesEndpoint = require('../endpoints/granules');
const granules = new models.Granule();

const { testEndpoint } = require('./testUtils');
const { Search } = require('../es/search');

const testGranule = {
  name: 'granule-0123',
  dataType: 'collection-dataType'
  files: []
};

const hash = { name: 'name', type: 'S' };
const range = { name: 'version', type: 'S' };
const esIndex = 'cumulus-index';

async function setup() {
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);

  await aws.s3().createBucket({ Bucket: process.env.internal }).promise();
  await models.Manager.createTable(process.env.GranulesTable, hash, range);
  await collections.create(testCollection);
}

async function teardown() {
  models.Manager.deleteTable(process.env.GranulesTable);
  await aws.recursivelyDeleteS3Bucket(process.env.internal);

  const esClient = await Search.es('fakehost');
  await esClient.indices.delete({ index: esIndex });
}

test.before(async () => setup());
test.after.always(async () => teardown());

test('default returns list of granules', (t) => {
  const listEvent = { httpMethod: 'list' };
  return testEndpoint(collectionsEndpoint, listEvent, (response) => {
    const { results } = JSON.parse(response.body);
    t.is(results.length, 1);
  });
});

test('GET returns an existing granule', (t) => {
  const getEvent = {
    httpMethod: 'GET',
    pathParameters: {
      granuleName: testGranule.name,
    }
  };

  return testEndpoint(collectionsEndpoint, getEvent, (response) => {
    const { name } = JSON.parse(response.body);
    t.is(name, testCollection.name);
  });
});

test('POST creates a new granule', (t) => {
  const newGranule = Object.assign({}, testGranule, {name: 'granule-post'});
  const postEvent = {
    httpMethod: 'POST',
    body: JSON.stringify(newGranule)
  };
  return testEndpoint(granulesEndpoint, postEvent, (response) => {
    const { message, record } = JSON.parse(response.body);
    t.is(message, 'Record saved');
    t.is(record.name, newGranule.name);
  });
});

test('PUT with action `move` moves an existing granule', (t) => {
  const newPath = '/new_path';

  const updateEvent = {
    body: JSON.stringify({
      name: testCollection.name,
      version: testCollection.version,
      provider_path: newPath
    }),
    pathParameters: {
      collectionName: testCollection.name,
      version: testCollection.version,
    },
    httpMethod: 'PUT'
  };
  return testEndpoint(collectionsEndpoint, updateEvent, (response) => {
    const { provider_path } = JSON.parse(response.body);
    t.is(provider_path, newPath);
  });
});

test('DELETE deletes an existing granule', (t) => {
  const deleteEvent = {
    httpMethod: 'DELETE',
    pathParameters: {
      granuleName: testGranule.name
    }
  };
  return testEndpoint(granulesEndpoint, deleteEvent, (response) => {
    const { message } = JSON.parse(response.body);
    t.is(message, 'Record deleted');
  });
});

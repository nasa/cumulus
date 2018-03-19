'use strict';

const aws = require('@cumulus/common/aws');
const test = require('ava');

process.env.ProvidersTable = 'Test_ProviderTable';
process.env.stackName = 'test-stack';
process.env.internal = 'test-bucket';

const bootstrap = require('../lambdas/bootstrap');
const models = require('../models');
const providerEndpoint = require('../endpoints/providers');
const { testEndpoint } = require('./testUtils');
const providers = new models.Provider();

const testProvider = {
  id: 'orbiting-carbon-observatory-2',
  globalConnectionLimit: 1,
  protocol: 'http',
  host: 'https://oco.jpl.nasa.gov/',
  port: 80
};
const keyId = 'public.pub';

const hash = { name: 'id', type: 'S' };

async function setup() {
  await bootstrap.bootstrapElasticSearch('http://localhost:4571');
  await models.Manager.createTable(process.env.ProvidersTable, hash);
  await providers.create(testProvider);
}

async function teardown() {
  await models.Manager.deleteTable(process.env.ProvidersTable);
}

test.before(async () => setup());
test.after.always(async () => teardown());

// TODO(aimee): Add a provider to ES. List uses ES and we don't have any providers in ES.
test('default returns list of providers', (t) => {
  const listEvent = { httpMethod: 'list' };
  return testEndpoint(providerEndpoint, listEvent, (response) => {
    const { results } = JSON.parse(response.body);
    t.is(results.length, 0);
  });
});

test('GET returns an existing provider', (t) => {
  const getEvent = {
    httpMethod: 'GET',
    pathParameters: { id: testProvider.id }
  };
  return testEndpoint(providerEndpoint, getEvent, (response) => {
    t.is(JSON.parse(response.body).id, testProvider.id);
  });
});

test('POST creates a new provider', (t) => {
  const newProviderId = 'AQUA';
  const newProvider = Object.assign({}, testProvider, { id: newProviderId });
  const postEvent = {
    httpMethod: 'POST',
    body: JSON.stringify(newProvider)
  };
  return testEndpoint(providerEndpoint, postEvent, (response) => {
    const { message, record } = JSON.parse(response.body);
    t.is(message, 'Record saved');
    t.is(record.id, newProviderId);
  });
});

test('PUT updates an existing provider', (t) => {
  const updatedLimit = 2;
  const putEvent = {
    httpMethod: 'PUT',
    pathParameters: { id: testProvider.id },
    body: JSON.stringify({ globalConnectionLimit: updatedLimit })
  };
  return testEndpoint(providerEndpoint, putEvent, (response) => {
    const { globalConnectionLimit } = JSON.parse(response.body);
    t.is(globalConnectionLimit, updatedLimit);
  });
});

test('DELETE deletes an existing provider', (t) => {
  const deleteEvent = {
    httpMethod: 'DELETE',
    pathParameters: { id: testProvider.id }
  };
  return testEndpoint(providerEndpoint, deleteEvent, (response) => {
    const { message } = JSON.parse(response.body);
    t.is(message, 'Record deleted');
  });
});

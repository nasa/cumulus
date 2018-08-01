'use strict';

const test = require('ava');
const bootstrap = require('../../lambdas/bootstrap');
const { randomString } = require('@cumulus/common/test-utils');
const { Search } = require('../../es/search');
const { bootstrapDynamoDbTables } = require('../../lambdas/bootstrap');
const { deleteAliases } = require('../../lib/testUtils');
const models = require('../../models');
const mappings = require('../../models/mappings.json');
const testMappings = require('../data/testEsMappings.json');
const mappingsSubset = require('../data/testEsMappingsSubset.json');

let esClient;
const tableName = randomString();

test.before(async () => {
  await deleteAliases();
  // create collections table
  // await models.Manager.createTable(tableName, { name: 'someIndex', type: 'S' });
});

// Skipping this test for because LocalStack version 0.8.6 does not support pointInTime
test.skip.serial('bootstrap dynamoDb activates pointInTime on a given table', async (t) => {
  const resp = await bootstrapDynamoDbTables([{ name: tableName, pointInTime: true }]);

  t.is(
    resp.ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus,
    'ENABLED'
  );
});

test.skip.after.always(async () => {
  await models.Manager.deleteTable(tableName);
});

test.serial('bootstrap creates index with alias', async (t) => {
  const indexName = randomString();
  const testAlias = randomString();

  await bootstrap.bootstrapElasticSearch('fakehost', indexName, testAlias);
  esClient = await Search.es();

  t.is(await esClient.indices.exists({ index: indexName }), true);

  const alias = await esClient.indices.getAlias({ name: testAlias });

  t.deepEqual(Object.keys(alias), [indexName]);

  await esClient.indices.delete({ index: indexName });
});

test.serial('bootstrap adds alias to existing index', async (t) => {
  const indexName = randomString();
  const testAlias = randomString();

  esClient = await Search.es();

  await esClient.indices.create({
    index: indexName,
    body: { mappings }
  });

  await bootstrap.bootstrapElasticSearch('fakehost', indexName, testAlias);
  esClient = await Search.es();

  const alias = await esClient.indices.getAlias({ name: testAlias });

  t.deepEqual(Object.keys(alias), [indexName]);

  await esClient.indices.delete({ index: indexName });
});

test.serial('Missing types added to index', async (t) => {
  const indexName = randomString();
  const testAlias = randomString();

  esClient = await Search.es();

  await esClient.indices.create({
    index: indexName,
    body: { mappings: mappingsSubset }
  });

  t.deepEqual(
    await bootstrap.findMissingMappings(esClient, indexName, Object.keys(testMappings)),
    ['logs', 'deletedgranule']
  );

  await bootstrap.bootstrapElasticSearch('fakehost', indexName, testAlias);
  esClient = await Search.es();

  t.deepEqual(
    await bootstrap.findMissingMappings(esClient, indexName, Object.keys(testMappings)),
    []
  );

  await esClient.indices.delete({ index: indexName });
});

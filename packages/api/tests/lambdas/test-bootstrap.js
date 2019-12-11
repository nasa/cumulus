'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');

const bootstrap = require('../../lambdas/bootstrap');
const { Search } = require('../../es/search');
const { deleteAliases } = require('../../lib/testUtils');
const mappings = require('../../models/mappings.json');
const testMappings = require('../data/testEsMappings.json');
const mappingsSubset = require('../data/testEsMappingsSubset.json');
const mappingsNoFields = require('../data/testEsMappingsNoFields.json');

let esClient;

test.before(async () => {
  await deleteAliases();
});


test.serial('bootstrap creates index with alias', async (t) => {
  const indexName = randomString();
  const testAlias = randomString();

  await bootstrap.bootstrapElasticSearch('fakehost', indexName, testAlias);
  esClient = await Search.es();

  t.is((await esClient.indices.exists({ index: indexName })).body, true);

  const alias = await esClient.indices.getAlias({ name: testAlias })
    .then((response) => response.body);

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

  const alias = await esClient.indices.getAlias({ name: testAlias })
    .then((response) => response.body);

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
    await bootstrap.findMissingMappings(esClient, indexName, testMappings),
    ['logs', 'deletedgranule']
  );

  await bootstrap.bootstrapElasticSearch('fakehost', indexName, testAlias);
  esClient = await Search.es();

  t.deepEqual(
    await bootstrap.findMissingMappings(esClient, indexName, testMappings),
    []
  );

  await esClient.indices.delete({ index: indexName });
});

test.serial('Missing fields added to index', async (t) => {
  const indexName = randomString();
  const testAlias = randomString();

  esClient = await Search.es();

  await esClient.indices.create({
    index: indexName,
    body: { mappings: mappingsNoFields }
  });

  t.deepEqual(
    await bootstrap.findMissingMappings(esClient, indexName, testMappings),
    ['logs', 'execution']
  );

  await bootstrap.bootstrapElasticSearch('fakehost', indexName, testAlias);
  esClient = await Search.es();

  t.deepEqual(
    await bootstrap.findMissingMappings(esClient, indexName, testMappings),
    []
  );

  await esClient.indices.delete({ index: indexName });
});

test.serial('If an index exists with the alias name, it is deleted on bootstrap', async (t) => {
  const indexName = randomString();
  const testAlias = randomString();

  esClient = await Search.es();

  // Create index with name of alias we want to use
  await esClient.indices.create({
    index: testAlias,
    body: { mappings }
  });

  await bootstrap.bootstrapElasticSearch('fakehost', indexName, testAlias);
  esClient = await Search.es();

  // Get the index and make sure `testAlias` is not a key which would mean it's an index
  // If you use indices.exist on testAlias it'll return true because the alias is
  // applied to the index. Here we're checking it's an alias, not an index
  const { body: index } = await esClient.indices.get({ index: testAlias });

  t.falsy(index[testAlias]);

  await esClient.indices.delete({ index: indexName });
});

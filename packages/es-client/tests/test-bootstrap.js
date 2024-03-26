// TODO - rewrite using test context

'use strict';

const test = require('ava');

const { randomString, randomId } = require('@cumulus/common/test-utils');

const { bootstrapElasticSearch, findMissingMappings } = require('../bootstrap');
const { Search } = require('../search');
const mappings = require('../config/mappings.json');

const testMappings = require('./data/testEsMappings.json');
const mappingsSubset = require('./data/testEsMappingsSubset.json');
const mappingsNoFields = require('./data/testEsMappingsNoFields.json');

const esClient = new Search();
let cumulusEsClient;

test.before(async () => {
  cumulusEsClient = await esClient.getEsClient();
});

test('bootstrap creates index with alias', async (t) => {
  const indexName = randomId('esindex');
  const testAlias = randomId('esalias');

  await bootstrapElasticSearch({
    host: 'fakehost',
    index: indexName,
    alias: testAlias,
  });
  try {
    t.is((await cumulusEsClient.indices.exists({ index: indexName })).body, true);

    const alias = await cumulusEsClient.indices.getAlias({ name: testAlias })
      .then((response) => response.body);

    t.deepEqual(Object.keys(alias), [indexName]);
  } finally {
    await cumulusEsClient.indices.delete({ index: indexName });
  }
});

test.serial('bootstrap creates index with specified number of shards', async (t) => {
  const indexName = randomId('esindex');
  const testAlias = randomId('esalias');

  process.env.ES_INDEX_SHARDS = 4;
  try {
    await bootstrapElasticSearch({
      host: 'fakehost',
      index: indexName,
      alias: testAlias,
    });

    const indexSettings = await cumulusEsClient.indices.get({ index: indexName })
      .then((response) => response.body);

    t.is(indexSettings[indexName].settings.index.number_of_shards, '4');
  } finally {
    delete process.env.ES_INDEX_SHARDS;
    await cumulusEsClient.indices.delete({ index: indexName });
  }
});

test('bootstrap adds alias to existing index', async (t) => {
  const indexName = randomString();
  const testAlias = randomString();

  await cumulusEsClient.indices.create({
    index: indexName,
    body: { mappings },
  });

  await bootstrapElasticSearch({
    host: 'fakehost',
    index: indexName,
    alias: testAlias,
  });
  const alias = await cumulusEsClient.indices.getAlias({ name: testAlias })
    .then((response) => response.body);

  t.deepEqual(Object.keys(alias), [indexName]);

  await cumulusEsClient.indices.delete({ index: indexName });
});

test('Missing types added to index', async (t) => {
  const indexName = randomString();
  const testAlias = randomString();

  await cumulusEsClient.indices.create({
    index: indexName,
    body: { mappings: mappingsSubset },
  });

  t.deepEqual(
    await findMissingMappings(esClient, indexName, testMappings),
    ['deletedgranule']
  );

  await bootstrapElasticSearch({
    host: 'fakehost',
    index: indexName,
    alias: testAlias,
  });

  t.deepEqual(
    await findMissingMappings(esClient, indexName, testMappings),
    []
  );

  await cumulusEsClient.indices.delete({ index: indexName });
});

test('Missing fields added to index', async (t) => {
  const indexName = randomString();
  const testAlias = randomString();

  await cumulusEsClient.indices.create({
    index: indexName,
    body: { mappings: mappingsNoFields },
  });

  t.deepEqual(
    await findMissingMappings(esClient, indexName, testMappings),
    ['execution']
  );

  await bootstrapElasticSearch({
    host: 'fakehost',
    index: indexName,
    alias: testAlias,
  });

  t.deepEqual(
    await findMissingMappings(esClient, indexName, testMappings),
    []
  );

  await cumulusEsClient.indices.delete({ index: indexName });
});

test('If an index exists with the alias name, it is deleted on bootstrap', async (t) => {
  const indexName = randomString();
  const testAlias = randomString();

  // Create index with name of alias we want to use
  await cumulusEsClient.indices.create({
    index: testAlias,
    body: { mappings },
  });

  await bootstrapElasticSearch({
    host: 'fakehost',
    index: indexName,
    alias: testAlias,
  });
  // Get the index and make sure `testAlias` is not a key which would mean it's an index
  // If you use indices.exist on testAlias it'll return true because the alias is
  // applied to the index. Here we're checking it's an alias, not an index
  const { body: index } = await cumulusEsClient.indices.get({ index: testAlias });

  t.falsy(index[testAlias]);

  await cumulusEsClient.indices.delete({ index: indexName });
});

test('If an index exists with the alias name, and removeAliasConflict is set to false it is deleted on bootstrap', async (t) => {
  const indexName = randomString();
  const testAlias = randomString();

  // Create index with name of alias we want to use
  await cumulusEsClient.indices.create({
    index: testAlias,
    body: { mappings },
  });

  await t.throwsAsync(bootstrapElasticSearch({
    host: 'fakehost',
    index: indexName,
    alias: testAlias,
    removeAliasConflict: false,
  }), { message: 'Aborting ES recreation as configuration does not allow removal of index' });
});

test('If an alias exists that index is used and a new one is not created', async (t) => {
  const indexName = randomId('index');
  const existingIndex = randomId('index');
  const existingAlias = randomId('esalias');

  await bootstrapElasticSearch({
    host: 'fakehost',
    index: existingIndex,
    alias: existingAlias,
  });
  // Try bootstrapping with a different index name

  await bootstrapElasticSearch({
    host: 'fakehost',
    index: indexName,
    alias: existingAlias,
  });
  const indexExists = await cumulusEsClient.indices.exists({ index: indexName })
    .then((response) => response.body);

  t.false(indexExists);

  await cumulusEsClient.indices.delete({ index: existingIndex });
});

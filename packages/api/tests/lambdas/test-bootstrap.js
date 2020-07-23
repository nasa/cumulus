'use strict';

const test = require('ava');
const rewire = require('rewire');
const sinon = require('sinon');
const { randomString, randomId } = require('@cumulus/common/test-utils');

const bootstrap = rewire('../../lambdas/bootstrap');
const bootstrapElasticsearchIndex = bootstrap.__get__('bootstrapElasticsearchIndex');
const findMissingMappings = bootstrap.__get__('findMissingMappings');
const { Search } = require('../../es/search');
const esTypes = require('../../es/types');
const { bootstrapDynamoDbTables } = require('../../lambdas/bootstrap');
const mappings = require('../../models/mappings.json');
const testMappings = require('../data/testEsMappings.json');
const mappingsSubset = require('../data/testEsMappingsSubset.json');
const mappingsNoFields = require('../data/testEsMappingsNoFields.json');
const collectionMappingsSubset = require('../data/collectionMappingsSubset.json');
const { getMappingsByType } = require('../../es/types');

let esClient;

// This is for a skipped test: bootstrap dynamoDb activates pointInTime on a given table
const tableName = randomString();

// Skipping this test for because LocalStack version 0.8.6 does not support pointInTime
// When this test is back in, make sure to delete the table
test.serial.skip('bootstrap dynamoDb activates pointInTime on a given table', async (t) => {
  const resp = await bootstrapDynamoDbTables([{ name: tableName, pointInTime: true }]);

  t.is(
    resp.ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus,
    'ENABLED'
  );
});

test.serial('bootstrap index creates index with alias', async (t) => {
  const indexName = randomId('esindex');
  const testAlias = randomId('esalias');

  esClient = await Search.es();
  await bootstrapElasticsearchIndex(esClient, 'rule', testAlias, indexName);

  try {
    t.is((await esClient.indices.exists({ index: indexName })).body, true);

    const alias = await esClient.indices.getAlias({ name: testAlias })
      .then((response) => response.body);

    t.deepEqual(Object.keys(alias), [indexName]);
  } finally {
    await esClient.indices.delete({ index: indexName });
  }
});

test.serial('bootstrap index creates index with specified number of shards', async (t) => {
  const indexName = randomId('esindex');
  const testAlias = randomId('esalias');

  process.env.ES_INDEX_SHARDS = 4;
  try {
    esClient = await Search.es();
    await bootstrapElasticsearchIndex(esClient, 'rule', testAlias, indexName);

    const indexSettings = await esClient.indices.get({ index: indexName })
      .then((response) => response.body);

    t.is(indexSettings[indexName].settings.index.number_of_shards, '4');
  } finally {
    delete process.env.ES_INDEX_SHARDS;
    await esClient.indices.delete({ index: indexName });
  }
});

test.serial('bootstrap index adds alias to existing index', async (t) => {
  const indexName = randomString();
  const testAlias = randomString();

  esClient = await Search.es();

  await esClient.indices.create({
    index: indexName,
    body: { mappings }
  });

  esClient = await Search.es();
  await bootstrapElasticsearchIndex(esClient, 'rule', testAlias, indexName);

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

  const stub = sinon.stub(esTypes, 'getMappingsByType').returns(testMappings);

  try {
    t.deepEqual(
      await findMissingMappings(esClient, indexName, 'rule'),
      ['logs', 'deletedgranule']
    );

    await bootstrapElasticsearchIndex(esClient, 'rule', testAlias, indexName);

    t.deepEqual(
      await findMissingMappings(esClient, indexName, 'rule'),
      []
    );
  } finally {
    stub.restore();
    await esClient.indices.delete({ index: indexName });
  }
});

test.serial('Missing fields added to index', async (t) => {
  const indexName = randomString();
  const testAlias = randomString();

  esClient = await Search.es();

  await esClient.indices.create({
    index: indexName,
    body: { mappings: mappingsNoFields }
  });

  const stub = sinon.stub(esTypes, 'getMappingsByType').returns(testMappings);

  try {
    t.deepEqual(
      await findMissingMappings(esClient, indexName, 'rule'),
      ['logs', 'execution']
    );

    await bootstrapElasticsearchIndex(esClient, 'rule', testAlias, indexName);

    t.deepEqual(
      await findMissingMappings(esClient, indexName, 'rule'),
      []
    );
  } finally {
    stub.restore();
    await esClient.indices.delete({ index: indexName });
  }
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

  await bootstrapElasticsearchIndex(esClient, 'rule', testAlias, indexName);

  // Get the index and make sure `testAlias` is not a key which would mean it's an index
  // If you use indices.exist on testAlias it'll return true because the alias is
  // applied to the index. Here we're checking it's an alias, not an index
  const { body: index } = await esClient.indices.get({ index: testAlias });

  t.falsy(index[testAlias]);

  await esClient.indices.delete({ index: indexName });
});

test.serial('bootstrap creates index with alias', async (t) => {
  const indexName = randomId('esindex');
  const testAlias = randomId('esalias');

  esClient = await Search.es();
  await bootstrap.bootstrapElasticSearch('fakehost', indexName, testAlias);

  try {
    t.is((await esClient.indices.exists({ index: indexName })).body, true);

    const alias = await esClient.indices.getAlias({ name: testAlias })
      .then((response) => response.body);

    t.deepEqual(Object.keys(alias), [indexName]);
  } finally {
    await esClient.indices.delete({ index: indexName });
  }
});

test.serial('bootstrap index creates index with alias for multi-indices environment', async (t) => {
  const indexName = randomId('esindex');
  const testAlias = randomId('esalias');

  const expectedIndexName = `${indexName}-rule`;
  const expectedAliasName = `${testAlias}-rule`;

  esClient = await Search.es();

  process.env.MULTI_INDICES = true;
  try {
    await bootstrapElasticsearchIndex(esClient, 'rule', testAlias, indexName);

    t.is((await esClient.indices.exists({ index: expectedIndexName })).body, true);

    const alias = await esClient.indices.getAlias({ name: expectedAliasName })
      .then((response) => response.body);

    t.deepEqual(Object.keys(alias), [expectedIndexName]);
  } finally {
    delete process.env.MULTI_INDICES;
    await esClient.indices.delete({ index: expectedIndexName });
  }
});

test.serial('bootstrap creates an index with alias for each ES type in a  multi-indices environment', async (t) => {
  const indexName = randomId('esindex');
  const testAlias = randomId('esalias');

  esClient = await Search.es();

  process.env.MULTI_INDICES = true;
  const types = esTypes.getEsTypes();
  try {
    await bootstrap.bootstrapElasticSearch('fakehost', indexName, testAlias);

    types.forEach(async (type) => {
      const expectedIndexName = `${indexName}-${type}`;
      const expectedAliasName = `${testAlias}-${type}`;

      t.is((await esClient.indices.exists({ index: expectedIndexName })).body, true);

      const alias = await esClient.indices.getAlias({ name: expectedAliasName })
        .then((response) => response.body);

      t.deepEqual(Object.keys(alias), [expectedIndexName]);
    });
  } finally {
    delete process.env.MULTI_INDICES;
    await Promise.all(types.map((type) => esClient.indices.delete({ index: `${indexName}-${type}` })));
  }
});

test.serial('bootstrap creates indexes and aliases for missing es types in a  multi-indices environment', async (t) => {
  const indexName = randomId('esindex');
  const testAlias = randomId('esalias');

  esClient = await Search.es();

  process.env.MULTI_INDICES = true;

  const types = ['collection', 'rule'];
  const stub = sinon.stub(esTypes, 'getEsTypes').returns(types);
  try {
    await esClient.indices.create({
      index: `${indexName}-collection`,
      body: {
        mappings: getMappingsByType('collection')
      }
    });

    await bootstrap.bootstrapElasticSearch('fakehost', indexName, testAlias);

    types.forEach(async (type) => {
      const expectedIndexName = `${indexName}-${type}`;
      const expectedAliasName = `${testAlias}-${type}`;

      t.is((await esClient.indices.exists({ index: expectedIndexName })).body, true);

      const alias = await esClient.indices.getAlias({ name: expectedAliasName })
        .then((response) => response.body);

      t.deepEqual(Object.keys(alias), [expectedIndexName]);
    });
  } finally {
    stub.restore();
    delete process.env.MULTI_INDICES;
    await Promise.all(types.map((type) => esClient.indices.delete({ index: `${indexName}-${type}` })));
  }
});

test.only('bootstrap creates missing mappings in a multi-indices environment', async (t) => {
  const indexName = randomId('esindex');
  const testAlias = randomId('esalias');

  esClient = await Search.es();

  process.env.MULTI_INDICES = true;

  const types = ['collection'];
  const stub = sinon.stub(esTypes, 'getEsTypes').returns(types);
  const collectionIndexName = `${indexName}-collection`;
  try {
    await esClient.indices.create({
      index: collectionIndexName,
      body: {
        mappings: collectionMappingsSubset
      }
    });

    console.log('done');

    t.deepEqual(
      await findMissingMappings(esClient, collectionIndexName, 'collection'),
      ['collection']
    );

    await bootstrapElasticsearchIndex(esClient, 'collection', testAlias, indexName);

    t.deepEqual(
      await findMissingMappings(esClient, collectionIndexName, 'collection'),
      []
    );
  } finally {
    stub.restore();
    delete process.env.MULTI_INDICES;
    await esClient.indices.delete({ index: collectionIndexName });
  }
});

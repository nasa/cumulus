'use strict';

const test = require('ava');
const rewire = require('rewire');
const sinon = require('sinon');
const sortBy = require('lodash/sortBy');
const range = require('lodash/range');

const awsServices = require('@cumulus/aws-client/services');
const s3 = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');

const indexer = rewire('../indexer');
const Collection = require('../collections');
const { EsClient } = require('../search');
const { bootstrapElasticSearch } = require('../bootstrap');

process.env.system_bucket = randomId('system-bucket');
process.env.stackName = randomId('stackName');

let esClient; // TODO - make this part of test context
let esAlias;
let esIndex;

// Before each test create a new index and use that since it's very important for
// these tests to test a clean ES index
test.before(async () => {
  // create buckets
  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket });

  esAlias = randomId('esalias');
  esIndex = randomId('esindex');
  process.env.ES_INDEX = esAlias;

  // create the elasticsearch index and add mapping
  await bootstrapElasticSearch({
    host: 'fakehost',
    index: esIndex,
    alias: esAlias,
  });
  esClient = new EsClient();
  await esClient.initializeEsClient();

  await Promise.all([
    indexer.indexCollection(esClient, {
      name: 'coll1',
      version: '1',
    }, esAlias),
    indexer.indexCollection(esClient, {
      name: 'coll1',
      version: '2',
    }, esAlias),
    indexer.indexCollection(esClient, {
      name: 'coll2',
      version: '1',
    }, esAlias),
    indexer.indexGranule(esClient, {
      granuleId: randomId('granule'),
      collectionId: constructCollectionId('coll1', '1'),
      status: 'completed',
    }, esAlias),
    indexer.indexGranule(esClient, {
      granuleId: randomId('granule'),
      collectionId: constructCollectionId('coll1', '1'),
      status: 'completed',
    }, esAlias),
  ]);

  // Adding a bunch of collections with granules to test more than 10 collections
  // can be returned
  await Promise.all(range(9).map((i) =>
    indexer.indexCollection(esClient, {
      name: 'coll4',
      version: i.toString(),
    }, esAlias)));

  await Promise.all(range(9).map((i) =>
    indexer.indexGranule(esClient, {
      granuleId: randomId('granule'),
      collectionId: constructCollectionId('coll4', i),
      status: 'completed',
    }, esAlias)));

  // Add more than 10 granules to "coll4___0"
  await Promise.all(range(10).map(() =>
    indexer.indexGranule(esClient, {
      granuleId: randomId('granule'),
      collectionId: constructCollectionId('coll4', '0'),
      status: 'completed',
    }, esAlias)));

  // Indexing using Date.now() to generate the timestamp
  const stub = sinon.stub(Date, 'now').returns((new Date(2020, 0, 29)).getTime());

  try {
    await Promise.all([
      indexer.indexCollection(esClient, {
        name: 'coll3',
        version: '1',
        updatedAt: new Date(2020, 0, 29),
      }, esAlias),
      indexer.indexGranule(esClient, {
        granuleId: randomId('granule'),
        updatedAt: new Date(2020, 1, 29),
        collectionId: constructCollectionId('coll3', '1'),
        status: 'completed',
      }, esAlias),
    ]);
  } finally {
    stub.restore();
  }
});

test.after.always(async () => {
  await esClient.client.indices.delete({ index: esIndex });
  await s3.recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.serial('getStats returns an empty list if there are no records or ids', async (t) => {
  const collectionSearch = new Collection({}, undefined, process.env.ES_INDEX, true);
  const stats = await collectionSearch.getStats([], []);

  t.deepEqual([], stats);
});

test.serial('getStats returns an empty list if there are no records', async (t) => {
  const collectionSearch = new Collection({}, undefined, process.env.ES_INDEX, true);
  const stats = await collectionSearch.getStats([], ['coll1___1']);

  t.deepEqual(stats, []);
});

test.serial('getStats returns empty stats if there are no ids', async (t) => {
  const records = [
    { name: 'coll1', version: '1' },
    { name: 'coll1', version: '2' },
  ];
  const collectionSearch = new Collection({}, undefined, process.env.ES_INDEX, true);
  const stats = await collectionSearch.getStats(records, []);

  t.deepEqual(stats,
    records.map((r) => ({
      ...r,
      stats: {
        running: 0,
        completed: 0,
        failed: 0,
        total: 0,
      },
    })));
});

test.serial('getStats correctly adds stats', async (t) => {
  const collectionSearch = new Collection({}, undefined, process.env.ES_INDEX, true);
  const stats = await collectionSearch.getStats([{ name: 'coll1', version: '1' }], ['coll1___1']);

  t.is(stats.length, 1);
  t.deepEqual(stats[0].stats, {
    running: 0,
    completed: 2,
    failed: 0,
    total: 2,
  });
});

test.serial('getStats correctly adds stats to different versions of collections', async (t) => {
  const collectionSearch = new Collection({}, undefined, process.env.ES_INDEX, true);
  const stats = await collectionSearch.getStats([
    {
      name: 'coll1',
      version: '1',
    },
    {
      name: 'coll1',
      version: '2',
    },
  ],
  ['coll1___1', 'coll1___2']);

  t.is(stats.length, 2);
  t.deepEqual(stats, [
    {
      name: 'coll1',
      version: '1',
      stats: {
        running: 0,
        completed: 2,
        failed: 0,
        total: 2,
      },
    },
    {
      name: 'coll1',
      version: '2',
      stats: {
        running: 0,
        completed: 0,
        failed: 0,
        total: 0,
      },
    },
  ]);
});

test.serial('addStatsToCollection add stats to ES collection results', async (t) => {
  const esResults = [
    {
      name: 'coll1',
      version: '1',
    },
    {
      name: 'coll1',
      version: '2',
    },
  ];

  const collectionSearch = new Collection({}, undefined, process.env.ES_INDEX, true);
  const resultsWithStats = await collectionSearch.addStatsToCollectionResults(esResults);

  t.deepEqual(resultsWithStats, [
    {
      name: 'coll1',
      version: '1',
      stats: {
        running: 0,
        completed: 2,
        failed: 0,
        total: 2,
      },
    },
    {
      name: 'coll1',
      version: '2',
      stats: {
        running: 0,
        completed: 0,
        failed: 0,
        total: 0,
      },
    },
  ]);
});

test.serial('addStatsToCollection returns empty list for no collections', async (t) => {
  const collectionSearch = new Collection({}, undefined, process.env.ES_INDEX, true);
  const resultsWithStats = await collectionSearch.addStatsToCollectionResults([]);

  t.deepEqual(resultsWithStats, []);
});

test.serial('query returns all collections with stats when requested', async (t) => {
  const collectionSearch = new Collection(
    { queryStringParameters: { limit: 13 } },
    undefined,
    process.env.ES_INDEX,
    true
  );
  const queryResult = await collectionSearch.query();

  t.is(queryResult.meta.count, 13);

  const collections = queryResult.results.map((c) => ({
    name: c.name,
    version: c.version,
    stats: c.stats,
  }));

  const orderedCollections = sortBy(collections, ['name', 'version']);
  t.deepEqual(orderedCollections, [
    {
      name: 'coll1',
      version: '1',
      stats: {
        running: 0,
        completed: 2,
        failed: 0,
        total: 2,
      },
    },
    {
      name: 'coll1',
      version: '2',
      stats: {
        running: 0,
        completed: 0,
        failed: 0,
        total: 0,
      },
    },
    {
      name: 'coll2',
      version: '1',
      stats: {
        running: 0,
        completed: 0,
        failed: 0,
        total: 0,
      },
    },
    {
      name: 'coll3',
      version: '1',
      stats: {
        running: 0,
        completed: 1,
        failed: 0,
        total: 1,
      },
    },
    {
      name: 'coll4',
      version: '0',
      stats: {
        running: 0,
        completed: 11,
        failed: 0,
        total: 11,
      },
    },
  ].concat(range(1, 9).map((i) => ({
    name: 'coll4',
    version: i.toString(),
    stats: {
      running: 0,
      completed: 1,
      failed: 0,
      total: 1,
    },
  }))));
});

test.serial('Collection query returns all collections without stats by default', async (t) => {
  const collectionSearch = new Collection(
    { queryStringParameters: { limit: 13 } },
    undefined,
    process.env.ES_INDEX
  );
  const queryResult = await collectionSearch.query();

  t.is(queryResult.meta.count, 13);

  const collections = queryResult.results.map((c) => ({
    name: c.name,
    version: c.version,
    stats: c.stats,
  }));

  const orderedCollections = sortBy(collections, ['name', 'version']);
  t.deepEqual(orderedCollections, [
    {
      name: 'coll1',
      version: '1',
      stats: undefined,
    },
    {
      name: 'coll1',
      version: '2',
      stats: undefined,
    },
    {
      name: 'coll2',
      version: '1',
      stats: undefined,
    },
    {
      name: 'coll3',
      version: '1',
      stats: undefined,
    },
    {
      name: 'coll4',
      version: '0',
      stats: undefined,
    },
  ].concat(range(1, 9).map((i) => ({
    name: 'coll4',
    version: i.toString(),
    stats: undefined,
  }))));
});

test.serial('query correctly queries collection by date', async (t) => {
  const collectionSearch = new Collection({
    queryStringParameters: {
      updatedAt__from: (new Date(2020, 0, 25)).getTime(),
      updatedAt__to: (new Date(2020, 0, 30)).getTime(),
    },
  }, undefined, process.env.ES_INDEX, true);
  const queryResult = await collectionSearch.query();

  t.is(queryResult.meta.count, 1);
  t.is(queryResult.results[0].name, 'coll3');
});

test.serial('aggregateGranuleCollections returns only collections with granules', async (t) => {
  const collectionSearch = new Collection({}, undefined, process.env.ES_INDEX, true);
  const queryResult = await collectionSearch.aggregateGranuleCollections();

  const orderedResult = queryResult.sort();

  t.deepEqual(
    orderedResult,
    ['coll1___1', 'coll3___1']
      .concat(range(9).map((i) => `coll4___${i}`))
  );
});

test.serial('aggregateGranuleCollections respects date range for granules', async (t) => {
  const collectionSearch = new Collection({
    queryStringParameters: {
      updatedAt__from: (new Date(2020, 1, 25)).getTime(),
      updatedAt__to: (new Date(2020, 1, 30)).getTime(),
    },
  }, undefined, process.env.ES_INDEX, true);
  const queryResult = await collectionSearch.aggregateGranuleCollections();

  t.deepEqual(queryResult, ['coll3___1']);
});

test.serial('queryCollectionsWithActiveGranules returns collection info and stats', async (t) => {
  const collectionSearch = new Collection(
    { queryStringParameters: { limit: 11 } },
    undefined,
    process.env.ES_INDEX,
    true
  );
  const queryResult = await collectionSearch.queryCollectionsWithActiveGranules();

  t.is(queryResult.meta.count, 11);

  const collections = queryResult.results.map((c) => ({
    name: c.name,
    version: c.version,
    stats: c.stats,
  }));

  const orderedCollections = sortBy(collections, ['name', 'version']);

  t.deepEqual(orderedCollections, [
    {
      name: 'coll1',
      version: '1',
      stats: {
        running: 0,
        completed: 2,
        failed: 0,
        total: 2,
      },
    },
    {
      name: 'coll3',
      version: '1',
      stats: {
        running: 0,
        completed: 1,
        failed: 0,
        total: 1,
      },
    },
    {
      name: 'coll4',
      version: '0',
      stats: {
        running: 0,
        completed: 11,
        failed: 0,
        total: 11,
      },
    },
  ].concat(range(1, 9).map((i) => ({
    name: 'coll4',
    version: i.toString(),
    stats: {
      running: 0,
      completed: 1,
      failed: 0,
      total: 1,
    },
  }))));
});

test.serial('Collection queryCollectionsWithActiveGranules returns collection info without statistics by default', async (t) => {
  const collectionSearch = new Collection(
    { queryStringParameters: { limit: 11 } },
    undefined,
    process.env.ES_INDEX
  );
  const queryResult = await collectionSearch.queryCollectionsWithActiveGranules();

  t.is(queryResult.meta.count, 11);

  const collections = queryResult.results.map((c) => ({
    name: c.name,
    version: c.version,
    stats: c.stats,
  }));

  const orderedCollections = sortBy(collections, ['name', 'version']);

  t.deepEqual(orderedCollections, [
    {
      name: 'coll1',
      version: '1',
      stats: undefined,
    },
    {
      name: 'coll3',
      version: '1',
      stats: undefined,
    },
    {
      name: 'coll4',
      version: '0',
      stats: undefined,
    },
  ].concat(range(1, 9).map((i) => ({
    name: 'coll4',
    version: i.toString(),
    stats: undefined,
  }))));
});

test.serial('queryCollectionsWithActiveGranules respects granule update times, but not collection', async (t) => {
  const collectionSearch = new Collection({
    queryStringParameters: {
      updatedAt__from: (new Date(2020, 1, 25)).getTime(),
      updatedAt__to: (new Date(2020, 1, 30)).getTime(),
    },
  }, undefined, process.env.ES_INDEX, true);
  const queryResult = await collectionSearch.queryCollectionsWithActiveGranules();

  t.is(queryResult.meta.count, 1);
  t.is(queryResult.results[0].name, 'coll3');
});

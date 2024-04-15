'use strict';

const test = require('ava');
const range = require('lodash/range');

const awsServices = require('@cumulus/aws-client/services');
const s3 = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');

const indexer = require('../indexer');
const { EsClient } = require('../search');
const { bootstrapElasticSearch } = require('../bootstrap');
const Stats = require('../stats');

process.env.system_bucket = randomId('system-bucket');
process.env.stackName = randomId('stackName');

test.before(async () => {
  // create buckets
  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket });
});

// Before each test create a new index and use that since it's very important for
// these tests to test a clean ES index
test.beforeEach(async (t) => {
  t.context.esAlias = randomId('esalias');
  t.context.esIndex = randomId('esindex');
  process.env.ES_INDEX = t.context.esAlias;

  // create the elasticsearch index and add mapping
  await bootstrapElasticSearch({
    host: 'fakehost',
    index: t.context.esIndex,
    alias: t.context.esAlias,
  });
  t.context.esClient = await new EsClient();
  await t.context.esClient.initializeEsClient();
});

test.afterEach(async (t) => {
  await t.context.esClient.client.indices.delete({ index: t.context.esIndex });
});

test.after.always(async () => {
  await s3.recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.serial('Stats does not return a collection if the collection has no active granules', async (t) => {
  const { esClient } = t.context;
  const collection = {
    name: randomId('name'),
    version: 1,
  };
  await indexer.indexCollection(esClient, collection, t.context.esAlias);

  const stats = new Stats({}, undefined, process.env.ES_INDEX);
  const queryResult = await stats.query();

  t.is(queryResult.collections.value, 0);
});

test.serial('Stats returns one granule when a granule is indexed', async (t) => {
  const { esClient } = t.context;
  const granule = {
    granuleId: randomId('granule'),
    collectionId: constructCollectionId(randomId('name'), 1),
  };
  await indexer.indexGranule(esClient, granule, t.context.esAlias);

  const stats = new Stats({}, undefined, process.env.ES_INDEX);
  const queryResult = await stats.query();

  t.is(queryResult.granules.value, 1);
});

test.serial('Stats returns correct granule errors', async (t) => {
  const { esClient } = t.context;
  await Promise.all(
    range(10).map(() => indexer.indexGranule(esClient, {
      granuleId: randomId('granule'),
      collectionId: constructCollectionId(randomId('name'), 1),
    }, t.context.esAlias))
  );

  await Promise.all([
    indexer.indexGranule(esClient, {
      granuleId: randomId('granule'),
      status: 'failed',
      collectionId: constructCollectionId(randomId('name'), 1),
    }, t.context.esAlias),
    indexer.indexGranule(esClient, {
      granuleId: randomId('granule'),
      status: 'failed',
      collectionId: constructCollectionId(randomId('name'), 1),
    }, t.context.esAlias),
  ]);

  const stats = new Stats({}, undefined, process.env.ES_INDEX);
  const queryResult = await stats.query();

  t.is(queryResult.granules.value, 12);
  t.is(queryResult.errors.value, 2);
});

test.serial('Count returns 0 if there are no granules', async (t) => {
  const stats = new Stats({}, undefined, process.env.ES_INDEX);
  const countResult = await stats.count();

  t.is(countResult.meta.count, 0);
});

test.serial('Count returns correct granule and collection count', async (t) => {
  const { esClient } = t.context;

  await Promise.all(
    range(12).map(() =>
      indexer.indexCollection(esClient, {
        name: randomId('collection'),
        version: 1,
      }, t.context.esAlias))
  );

  await Promise.all(
    range(10).map(() => indexer.indexGranule(esClient, {
      granuleId: randomId('granule'),
      collectionId: constructCollectionId(randomId('name'), 1),
      status: 'completed',
    }, t.context.esAlias))
  );

  await Promise.all([
    indexer.indexGranule(esClient, {
      granuleId: randomId('granule'),
      status: 'failed',
      collectionId: constructCollectionId(randomId('name'), 1),
    }, t.context.esAlias),
    indexer.indexGranule(esClient, {
      granuleId: randomId('granule'),
      collectionId: constructCollectionId(randomId('name'), 1),
      status: 'failed',
    }, t.context.esAlias),
  ]);

  const stats = new Stats({}, 'granule', process.env.ES_INDEX);
  const countResult = await stats.count();

  t.is(countResult.meta.count, 12);
  t.deepEqual(countResult.count, [
    { key: 'completed', count: 10 },
    { key: 'failed', count: 2 },
  ]);

  const collectionStats = new Stats({}, 'collection', process.env.ES_INDEX);
  const collectionCountResult = await collectionStats.count();

  t.is(collectionCountResult.meta.count, 12);
});

test.serial('Count returns correct count for date range', async (t) => {
  const { esClient } = t.context;
  await Promise.all([
    indexer.indexGranule(esClient, {
      granuleId: randomId('granule'),
      updatedAt: new Date(2020, 0, 27),
      status: 'completed',
      collectionId: constructCollectionId(randomId('name'), 1),
    }, t.context.esAlias),
    indexer.indexGranule(esClient, {
      granuleId: randomId('granule'),
      status: 'completed',
      collectionId: constructCollectionId(randomId('name'), 1),
      updatedAt: new Date(),
    }, t.context.esAlias),
    indexer.indexGranule(esClient, {
      granuleId: randomId('granule'),
      collectionId: constructCollectionId(randomId('name'), 1),
      status: 'failed',
      updatedAt: new Date(),
    }, t.context.esAlias),
    indexer.indexGranule(esClient, {
      granuleId: randomId('granule'),
      status: 'failed',
      updatedAt: new Date(2020, 0, 29),
      collectionId: constructCollectionId(randomId('name'), 1),
    }, t.context.esAlias),
  ]);

  let stats = new Stats(
    { queryStringParameters: { updatedAt__to: (new Date(2020, 0, 30)).getTime() } },
    'granule',
    process.env.ES_INDEX
  );
  let countResult = await stats.count();

  t.is(countResult.meta.count, 2);
  t.deepEqual(countResult.count, [
    { key: 'completed', count: 1 },
    { key: 'failed', count: 1 },
  ]);

  stats = new Stats(
    { queryStringParameters: { updatedAt__from: (new Date(2020, 0, 30)).getTime() } },
    'granule',
    process.env.ES_INDEX
  );
  countResult = await stats.count();

  t.is(countResult.meta.count, 2);
  t.deepEqual(countResult.count, [
    { key: 'completed', count: 1 },
    { key: 'failed', count: 1 },
  ]);

  stats = new Stats(
    {
      queryStringParameters: {
        updatedAt__from: (new Date(2020, 0, 25)).getTime(),
        updatedAt__to: (new Date(2020, 0, 28)).getTime(),
      },
    },
    'granule',
    process.env.ES_INDEX
  );
  countResult = await stats.count();

  t.is(countResult.meta.count, 1);
  t.deepEqual(countResult.count, [
    { key: 'completed', count: 1 },
  ]);
});

test.serial('Count returns correct count for with custom field specified', async (t) => {
  const { esClient } = t.context;
  await Promise.all([
    indexer.indexGranule(esClient, {
      granuleId: randomId('granule'),
      collectionId: 'collection1',
    }, t.context.esAlias),
    indexer.indexGranule(esClient, {
      granuleId: randomId('granule'),
      collectionId: 'collection2',
    }, t.context.esAlias),
    indexer.indexGranule(esClient, {
      granuleId: randomId('granule'),
      collectionId: 'collection3',
      status: 'failed',
    }, t.context.esAlias),
    indexer.indexGranule(esClient, {
      granuleId: randomId('granule'),
      collectionId: 'collection1',
      status: 'failed',
      updatedAt: new Date(2020, 0, 29),
    }, t.context.esAlias),
  ]);

  const stats = new Stats(
    { queryStringParameters: { field: 'collectionId' } },
    'granule',
    process.env.ES_INDEX
  );
  const countResult = await stats.count();

  t.is(countResult.meta.count, 4);
  t.deepEqual(countResult.count, [
    { key: 'collection1', count: 2 },
    { key: 'collection2', count: 1 },
    { key: 'collection3', count: 1 },
  ]);
});

'use strict';

const test = require('ava');
const rewire = require('rewire');

const awsServices = require('@cumulus/aws-client/services');
const s3 = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');

const indexer = rewire('../../es/indexer');
const { Search } = require('../../es/search');
const models = require('../../models');
const { fakeGranuleFactoryV2, fakeCollectionFactory } = require('../../lib/testUtils');
const { bootstrapElasticSearch } = require('../../lambdas/bootstrap');
const Stats = require('../../es/stats');

const collectionTable = randomId('collectionsTable');
const granuleTable = randomId('granulesTable');

process.env.system_bucket = randomId('systemBucket');
process.env.stackName = randomId('stackName');

let esClient;
let collectionModel;
let granuleModel;

test.before(async () => {
  // create the tables
  process.env.CollectionsTable = collectionTable;
  collectionModel = new models.Collection();
  await collectionModel.createTable();

  process.env.GranulesTable = granuleTable;
  granuleModel = new models.Granule();
  await granuleModel.createTable();

  // create buckets
  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket }).promise();
});

// Before each test create a new index and use that since it's very important for
// these tests to test a clean ES index
test.beforeEach(async (t) => {
  t.context.esAlias = randomId('esalias');
  t.context.esIndex = randomId('esindex');
  process.env.ES_INDEX = t.context.esAlias;

  // create the elasticsearch index and add mapping
  await bootstrapElasticSearch('fakehost', t.context.esIndex, t.context.esAlias);
  esClient = await Search.es();
});

test.afterEach(async (t) => {
  await esClient.indices.delete({ index: t.context.esIndex });
});

test.after.always(async () => {
  await collectionModel.deleteTable();
  await granuleModel.deleteTable();
  await s3.recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.serial('Stats returns one collection when a collecion is indexed', async (t) => {
  const collection = fakeCollectionFactory();
  await indexer.indexCollection(esClient, collection, t.context.esAlias);

  const stats = new Stats({}, null, process.env.ES_INDEX);
  const queryResult = await stats.query();

  t.is(queryResult.collections.value, 1);
});

test.serial('Stats returns one granule when a granule is indexed', async (t) => {
  const granule = fakeGranuleFactoryV2();
  await indexer.indexGranule(esClient, granule, t.context.esAlias);

  const stats = new Stats({}, null, process.env.ES_INDEX);
  const queryResult = await stats.query();

  t.is(queryResult.granules.value, 1);
});

test.serial('Stats returns correct granule errors', async (t) => {
  await Promise.all([
    indexer.indexGranule(esClient, fakeGranuleFactoryV2(), t.context.esAlias),
    indexer.indexGranule(esClient, fakeGranuleFactoryV2(), t.context.esAlias),
    indexer.indexGranule(esClient, fakeGranuleFactoryV2({ status: 'failed' }), t.context.esAlias),
    indexer.indexGranule(esClient, fakeGranuleFactoryV2({ status: 'failed' }), t.context.esAlias)
  ]);

  const stats = new Stats({}, null, process.env.ES_INDEX);
  const queryResult = await stats.query();

  t.is(queryResult.granules.value, 4);
  t.is(queryResult.errors.value, 2);
});

test.serial('Count returns 0 if there are no granules', async (t) => {
  const stats = new Stats({}, null, process.env.ES_INDEX);
  const countResult = await stats.count();

  t.is(countResult.meta.count, 0);
});

test.serial('Count returns correct granule and collection count', async (t) => {
  await Promise.all([
    indexer.indexCollection(esClient, fakeCollectionFactory(), t.context.esAlias),
    indexer.indexGranule(esClient, fakeGranuleFactoryV2(), t.context.esAlias),
    indexer.indexGranule(esClient, fakeGranuleFactoryV2(), t.context.esAlias),
    indexer.indexGranule(esClient, fakeGranuleFactoryV2({ status: 'failed' }), t.context.esAlias),
    indexer.indexGranule(esClient, fakeGranuleFactoryV2({ status: 'failed' }), t.context.esAlias)
  ]);

  const stats = new Stats({}, 'granule', process.env.ES_INDEX);
  const countResult = await stats.count();

  t.is(countResult.meta.count, 4);
  t.deepEqual(countResult.count, [
    { key: 'completed', count: 2 },
    { key: 'failed', count: 2 }
  ]);

  const collectionStats = new Stats({}, 'collection', process.env.ES_INDEX);
  const collectionCountResult = await collectionStats.count();

  t.is(collectionCountResult.meta.count, 1);
});

'use strict';

const test = require('ava');
const orderBy = require('lodash/orderBy');

const { randomId } = require('@cumulus/common/test-utils');

const indexer = require('../indexer');
const { Search, EsClient } = require('../search');
const { bootstrapElasticSearch } = require('../bootstrap');

const collectionIds = [randomId('collectionId-abc'), randomId('collectionId-efg')];
const granules = [
  {
    collectionId: collectionIds[0],
    granuleId: randomId('granule'),
    status: 'completed',
  },
  {
    collectionId: collectionIds[1],
    granuleId: randomId('granprefix123'),
    status: 'completed',
  },
  { collectionId: collectionIds[1], granuleId: randomId('granprefix'), status: 'failed' },
  {
    granuleId: randomId('granule'),
    collectionId: collectionIds[0],
    status: 'failed',
  },
];
const reconciliationReports = [
  { type: 'Inventory' },
  { type: 'Granule Inventory' },
  { type: 'Granule Not Found' },
  { type: 'Internal' },
];

let esClient;
const esIndex = randomId('esindex');
const esAlias = randomId('esalias');
process.env.ES_INDEX = esAlias;

test.before(async () => {
  // create the elasticsearch index and add mapping
  await bootstrapElasticSearch({
    host: 'fakehost',
    index: esIndex,
    alias: esAlias,
  });

  esClient = new EsClient();
  await esClient.initializeEsClient();
  await Promise.all(
    granules.map((granule) => indexer.indexGranule(esClient, granule, esAlias))
  );

  await Promise.all(
    reconciliationReports.map(
      (report) => indexer.indexReconciliationReport(esClient, report, esAlias)
    )
  );
});

test.after.always(async () => {
  await esClient.client.indices.delete({ index: esIndex });
});

test('Search with prefix returns correct granules', async (t) => {
  const prefix = 'granprefix';
  const params = {
    limit: 50,
    page: 1,
    prefix,
  };

  const es = new Search(
    { queryStringParameters: params },
    'granule',
    process.env.ES_INDEX
  );

  const queryResult = await es.query();
  const resultGranules = queryResult.results;
  t.is(queryResult.meta.count, 2);
  t.is(resultGranules.length, 2);
  resultGranules.map((granule) =>
    t.true([granules[1].granuleId, granules[2].granuleId].includes(granule.granuleId)));
  t.deepEqual(resultGranules, orderBy(resultGranules, ['timestamp'], ['desc']));
});

test('Search with infix returns correct granules', async (t) => {
  const granuleId = granules[2].granuleId;
  const infix = granuleId.substring(4, 14);
  const params = {
    limit: 50,
    page: 1,
    order: 'desc',
    sort_by: 'timestamp',
    status: 'failed',
    infix,
  };

  const es = new Search(
    { queryStringParameters: params },
    'granule',
    process.env.ES_INDEX
  );

  const queryResult = await es.query();

  t.is(queryResult.meta.count, 1);
  t.is(queryResult.results.length, 1);
  t.is(queryResult.results[0].granuleId, granuleId);
});

test('Search with both prefix and infix returns correct granules', async (t) => {
  const prefix = 'granprefix';
  const infix = 'fix123';
  const params = {
    limit: 50,
    page: 1,
    order: 'desc',
    sort_by: 'timestamp',
    prefix,
    infix,
  };

  const es = new Search(
    { queryStringParameters: params },
    'granule',
    process.env.ES_INDEX
  );

  const queryResult = await es.query();

  t.is(queryResult.meta.count, 1);
  t.is(queryResult.results.length, 1);
  t.is(queryResult.results[0].granuleId, granules[1].granuleId);
});

test('Search with sort_key returns correctly ordered granules', async (t) => {
  const params = {
    limit: 50,
    page: 1,
    sort_key: ['-collectionId', '+status', 'granuleId'],
  };

  const es = new Search(
    { queryStringParameters: params },
    'granule',
    process.env.ES_INDEX
  );

  const sortedGranules = orderBy(granules, ['collectionId', 'status', 'granuleId'], ['desc', 'asc', 'asc']);

  const queryResult = await es.query();
  t.is(queryResult.meta.count, 4);
  t.is(queryResult.results.length, 4);
  t.deepEqual(queryResult.results.map((g) => g.granuleId), sortedGranules.map((g) => g.granuleId));
});

test('Search with sort_by and order returns correctly ordered granules', async (t) => {
  const params = {
    limit: 50,
    page: 1,
    sort_by: 'granuleId',
    order: 'desc',
  };

  const es = new Search(
    { queryStringParameters: params },
    'granule',
    process.env.ES_INDEX
  );

  const sortedGranules = orderBy(granules, ['granuleId'], ['desc']);

  const queryResult = await es.query();
  t.is(queryResult.meta.count, 4);
  t.is(queryResult.results.length, 4);
  t.deepEqual(queryResult.results.map((g) => g.granuleId), sortedGranules.map((g) => g.granuleId));
});

test('Search with __not returns correct number of reports', async (t) => {
  const params = {
    limit: 50,
    page: 1,
    type__not: 'Granule Not Found',
  };

  const es = new Search(
    { queryStringParameters: params },
    'reconciliationReport',
    process.env.ES_INDEX
  );

  const queryResult = await es.query();

  t.is(queryResult.meta.count, 3);
  t.is(queryResult.results.length, 3);
  t.is(queryResult.results.filter((report) => report.type === 'Granule Not Found').length, 0);
});

test('Search with __in returns correct number of reports', async (t) => {
  const params = {
    limit: 50,
    page: 1,
    type__in: 'Inventory, Granule Not Found, Internal',
  };

  const es = new Search(
    { queryStringParameters: params },
    'reconciliationReport',
    process.env.ES_INDEX
  );

  const queryResult = await es.query();

  t.is(queryResult.meta.count, 1);
  t.is(queryResult.results.length, 1);
  t.is(queryResult.results.filter((report) => report.type === 'Granule Inventory').length, 0);
});

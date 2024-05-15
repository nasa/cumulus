'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');
const { StatsSearch } = require('../../dist/search/StatsSearch');

const {
  destroyLocalTestDb,
  generateLocalTestDb,
  GranulePgModel,
  CollectionPgModel,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  fakeProviderRecordFactory,
  migrationDir,
  fakePdrRecordFactory,
  fakeExecutionRecordFactory,
  PdrPgModel,
  ExecutionPgModel,
  ProviderPgModel,
} = require('../../dist');

const testDbName = `collection_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );

  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.collectionPgModel = new CollectionPgModel();
  t.context.granulePgModel = new GranulePgModel();
  t.context.providerPgModel = new ProviderPgModel();
  t.context.PdrPgModel = new PdrPgModel();
  t.context.ExecutionPgModel = new ExecutionPgModel();

  const statuses = ['queued', 'failed', 'completed', 'running'];
  const errors = [{ Error: { keyword: 'UnknownError' } }, { Error: { keyword: 'CumulusMessageAdapterError' } }, { Error: { keyword: 'IngestFailure' } }, { Error: { keyword: 'CmrFailure' } }, { Error: {} }];
  const granules = [];
  const collections = [];
  const executions = [];
  const pdrs = [];
  const providers = [];

  range(20).map((num) => (
    // collections is never aggregate queried
    collections.push(fakeCollectionRecordFactory({
      name: `testCollection${num}`,
      cumulus_id: num,
    }))
  ));

  range(10).map((num) => (
    // providers is never aggregate queried
    providers.push(fakeProviderRecordFactory({
      cumulus_id: num,
      name: `testProvider${num}`,
    }))
  ));

  range(100).map((num) => (
    // granules can be queried by timestampto/from, collectionid, providerid, status,
    granules.push(fakeGranuleRecordFactory({
      collection_cumulus_id: num % 20,
      granule_id: num % 2 === 0 ? `testGranule${num}` : `query__Granule${num}`,
      status: statuses[num % 4],
      created_at: (new Date(2018 + (num % 6), (num % 12), (num % 30))).toISOString(),
      updated_at: (new Date(2018 + (num % 6), (num % 12), ((num + 1) % 29))).toISOString(),
      error: errors[num % 5],
      duration: num + (num / 10),
      provider_cumulus_id: num % 10,
    }))
  ));

  range(20).map((num) => (
    // pdrs can be queried by timestampto/from, status
    pdrs.push(fakePdrRecordFactory({
      collection_cumulus_id: num,
      status: statuses[(num % 3) + 1],
      provider_cumulus_id: num % 10,
      created_at: (new Date(2018 + (num % 6), (num % 12), (num % 30))).toISOString(),
      updated_at: (new Date(2018 + (num % 6), (num % 12), ((num + 1) % 29))).toISOString(),
    // eslint-disable-next-line no-sequences
    })),
    // executions can be queried by: timestampto/from, collectionid, status
    executions.push(fakeExecutionRecordFactory({
      collection_cumulus_id: num,
      status: statuses[(num % 3) + 1],
      error: errors[num % 5],
      created_at: (new Date(2018 + (num % 6), (num % 12), (num % 30))).toISOString(),
      updated_at: (new Date(2018 + (num % 6), (num % 12), ((num + 1) % 29))).toISOString(),
    }))
  ));

  await t.context.collectionPgModel.insert(
    t.context.knex,
    collections
  );

  await t.context.providerPgModel.insert(
    t.context.knex,
    providers
  );

  await t.context.granulePgModel.insert(
    t.context.knex,
    granules
  );

  await t.context.ExecutionPgModel.insert(
    t.context.knex,
    executions
  );

  await t.context.PdrPgModel.insert(
    t.context.knex,
    pdrs
  );
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('StatsSearch returns correct response for basic granules query', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    type: 'granules',
  };
  const AggregateSearch = new StatsSearch({ queryStringParameters }, 'aggregate');
  const results = await AggregateSearch.query(knex);
  t.is(results.results.count.find((item) => item.key === 'completed').count, 25);
  t.is(results.results.count.find((item) => item.key === 'failed')?.count, 25);
  t.is(results.results.count.find((item) => item.key === 'queued')?.count, 25);
  t.is(results.results.count.find((item) => item.key === 'running')?.count, 25);
  t.is(results.meta.count, 100);
});

test('StatsSearch filters correctly by date', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    type: 'granules',
    timestamp__from: `${(new Date(2020, 1, 28)).getTime()}`,
    timestamp__to: `${(new Date(2022, 2, 30)).getTime()}`,
  };

  const AggregateSearch = new StatsSearch({ queryStringParameters }, 'aggregate');
  const results = await AggregateSearch.query(knex);
  t.is(results.results.count.find((item) => item.key === 'completed').count, 9);
  t.is(results.results.count.find((item) => item.key === 'failed')?.count, 8);
  t.is(results.results.count.find((item) => item.key === 'queued')?.count, 8);
  t.is(results.results.count.find((item) => item.key === 'running')?.count, 9);
  t.is(results.meta.count, 34);
});

test('StatsSearch filters executions correctly', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    type: 'executions',
    field: 'status',
  };

  const AggregateSearch = new StatsSearch({ queryStringParameters }, 'aggregate');
  const results = await AggregateSearch.query(knex);
  t.is(results.results.count.find((item) => item.key === 'completed').count, 7);
  t.is(results.results.count.find((item) => item.key === 'failed').count, 7);
  t.is(results.results.count.find((item) => item.key === 'running').count, 6);
  t.is(results.meta.count, 20);

  queryStringParameters = {
    type: 'executions',
    field: 'status',
    timestamp__to: `${(new Date(2023, 11, 30)).getTime()}`,
    timestamp__from: `${(new Date(2021, 1, 28)).getTime()}`,
  };

  const AggregateSearch2 = new StatsSearch({ queryStringParameters }, 'aggregate');
  const results2 = await AggregateSearch2.query(knex);
  t.is(results2.results.count.find((item) => item.key === 'completed').count, 3);
  t.is(results2.results.count.find((item) => item.key === 'failed').count, 3);
  t.is(results2.results.count.find((item) => item.key === 'running').count, 3);
  t.is(results2.meta.count, 9);

  queryStringParameters = {
    type: 'executions',
    field: 'status',
    timestamp__to: `${(new Date(2023, 11, 30)).getTime()}`,
    timestamp__from: `${(new Date(2021, 1, 28)).getTime()}`,
    collectionId: 'testCollection5',
    status: 'running',
  };

  const AggregateSearch3 = new StatsSearch({ queryStringParameters }, 'aggregate');
  const results3 = await AggregateSearch3.query(knex);
  t.is(results3.results.count.find((item) => item.key === 'running').count, 1);
  t.is(results3.meta.count, 1);
});

test('StatsSearch filters PDRs correctly', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    type: 'pdrs',
    field: 'status',
  };

  const AggregateSearch = new StatsSearch({ queryStringParameters }, 'aggregate');
  const results = await AggregateSearch.query(knex);
  t.is(results.results.count.find((item) => item.key === 'completed').count, 7);
  t.is(results.results.count.find((item) => item.key === 'failed').count, 7);
  t.is(results.results.count.find((item) => item.key === 'running').count, 6);
  t.is(results.meta.count, 20);

  queryStringParameters = {
    type: 'pdrs',
    field: 'status',
    timestamp__to: `${(new Date(2019, 12, 9)).getTime()}`,
    timestamp__from: `${(new Date(2018, 1, 28)).getTime()}`,
  };

  const AggregateSearch2 = new StatsSearch({ queryStringParameters }, 'aggregate');
  const results2 = await AggregateSearch2.query(knex);
  t.is(results2.results.count.find((item) => item.key === 'completed').count, 4);
  t.is(results2.results.count.find((item) => item.key === 'failed').count, 2);
  t.is(results2.meta.count, 6);
  queryStringParameters = {
    type: 'pdrs',
    field: 'status',
    timestamp__to: `${(new Date(2019, 12, 9)).getTime()}`,
    timestamp__from: `${(new Date(2018, 1, 28)).getTime()}`,
    status: 'failed',
  };

  const AggregateSearch3 = new StatsSearch({ queryStringParameters }, 'aggregate');
  const results3 = await AggregateSearch3.query(knex);
  t.is(results3.results.count.find((item) => item.key === 'failed').count, 2);
  t.is(results3.meta.count, 2);
});

test('StatsSearch returns correct response when queried by provider', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    type: 'granules',
    field: 'status',
    provider: 'testProvider2',
  };

  const AggregateSearch = new StatsSearch({ queryStringParameters }, 'aggregate');
  const results = await AggregateSearch.query(knex);
  t.is(results.meta.count, 10);
  t.is(results.results.count.find((item) => item.key === 'completed').count, 5);
  t.is(results.results.count.find((item) => item.key === 'queued').count, 5);
});

test('StatsSearch returns correct response when queried by collection', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    type: 'granules',
    field: 'status',
    collectionId: 'testCollection8',
  };

  const AggregateSearch = new StatsSearch({ queryStringParameters }, 'aggregate');
  const results = await AggregateSearch.query(knex);
  t.is(results.meta.count, 5);
});

test('StatsSearch returns correct response when queried by collection and provider', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    type: 'granules',
    field: 'status',
    collectionId: 'testCollection1',
    providerId: 'testProvider1',
  };

  const AggregateSearch = new StatsSearch({ queryStringParameters }, 'aggregate');
  const results = await AggregateSearch.query(knex);
  t.is(results.meta.count, 5);
  t.is(results.results.count.find((item) => item.key === 'failed').count, 5);

  queryStringParameters = {
    type: 'granules',
    field: 'status',
    collectionId: 'testCollection1',
    providerId: 'testProvider1',
    timestamp__to: `${(new Date(2019, 12, 9)).getTime()}`,
    timestamp__from: `${(new Date(2018, 1, 28)).getTime()}`,
  };

  const AggregateSearch2 = new StatsSearch({ queryStringParameters }, 'aggregate');
  const results2 = await AggregateSearch2.query(knex);
  t.is(results2.meta.count, 2);
  t.is(results2.results.count.find((item) => item.key === 'failed').count, 2);
  queryStringParameters = {
    type: 'granules',
    field: 'status',
    collectionId: 'testCollection1',
    providerId: 'testProvider1',
    timestamp__to: `${(new Date(2019, 12, 9)).getTime()}`,
    timestamp__from: `${(new Date(2018, 1, 28)).getTime()}`,
    status: 'failed',
  };

  const AggregateSearch3 = new StatsSearch({ queryStringParameters }, 'aggregate');
  const results3 = await AggregateSearch3.query(knex);
  t.is(results3.meta.count, 2);
  t.is(results3.results.count.find((item) => item.key === 'failed').count, 2);
});

test('StatsSearch returns correct response when queried by error', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    type: 'granules',
    field: 'error.Error.keyword',
  };
  const AggregateSearch = new StatsSearch({ queryStringParameters }, 'aggregate');
  const results = await AggregateSearch.query(knex);
  t.is(results.meta.count, 100);
  t.is(results.results.count.find((item) => item.key === 'CmrFailure').count, 20);
  t.is(results.results.count.find((item) => item.key === 'UnknownError').count, 20);
  t.is(results.results.count.find((item) => item.key === 'IngestFailure').count, 20);
  t.is(results.results.count.find((item) => item.key === 'CumulusMessageAdapterError').count, 20);
  queryStringParameters = {
    type: 'granules',
    field: 'error.Error.keyword',
    timestamp__to: `${(new Date(2021, 12, 9)).getTime()}`,
    timestamp__from: `${(new Date(2020, 1, 28)).getTime()}`,
  };
  const AggregateSearch2 = new StatsSearch({ queryStringParameters }, 'aggregate');
  const results2 = await AggregateSearch2.query(knex);
  t.is(results2.meta.count, 34);
  t.is(results2.results.count.find((item) => item.key === 'CmrFailure').count, 8);
  t.is(results2.results.count.find((item) => item.key === 'UnknownError').count, 6);
  t.is(results2.results.count.find((item) => item.key === 'IngestFailure').count, 7);
  t.is(results2.results.count.find((item) => item.key === 'CumulusMessageAdapterError').count, 6);
});

test('StatsSearch can query by infix and prefix when type is defined', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    type: 'granules',
    infix: 'testGra',
  };
  const AggregateSearch = new StatsSearch({ queryStringParameters }, 'aggregate');
  const results = await AggregateSearch.query(knex);
  t.is(results.meta.count, 50);
  t.is(results.results.count.find((item) => item.key === 'completed').count, 25);
  t.is(results.results.count.find((item) => item.key === 'queued').count, 25);

  queryStringParameters = {
    type: 'granules',
    prefix: 'query',
  };
  const AggregateSearch2 = new StatsSearch({ queryStringParameters }, 'aggregate');
  const results2 = await AggregateSearch2.query(knex);
  t.is(results2.meta.count, 50);
  t.is(results2.results.count.find((item) => item.key === 'failed').count, 25);
  t.is(results2.results.count.find((item) => item.key === 'running').count, 25);

  queryStringParameters = {
    type: 'collections',
    infix: 'testCollection8',
    field: 'name',
  };
  const AggregateSearch3 = new StatsSearch({ queryStringParameters }, 'aggregate');
  const results3 = await AggregateSearch3.query(knex);
  t.is(results3.meta.count, 1);
});

test('StatsSummary works', async (t) => {
  const { knex } = t.context;
  const StatsSummary = new StatsSearch({}, 'summary');
  const results = await StatsSummary.summary(knex);
  t.is(results.collections.value, 20);
  t.is(results.granules.value, 100);
  t.is(results.errors.value, 80);
  t.is(results.processingTime.value, 54.44999999642372);
  const queryStringParameters = {
    timestamp__to: `${(new Date(2019, 12, 9)).getTime()}`,
    timestamp__from: `${(new Date(2018, 1, 28)).getTime()}`,
  };
  const StatsSummary2 = new StatsSearch({ queryStringParameters }, 'summary');
  const results2 = await StatsSummary2.summary(knex);
  t.is(results2.collections.value, 15);
  t.is(results2.granules.value, 25);
  t.is(results2.errors.value, 21);
  t.is(results2.processingTime.value, 53.54799992084503);
});

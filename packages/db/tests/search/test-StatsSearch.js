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
  const errors = [{ Error: 'UnknownError' }, { Error: 'CumulusMessageAdapterError' }, { Error: 'IngestFailure' }, { Error: 'CmrFailure' }, { Error: {} }];
  const granules = [];
  const collections = [];
  const executions = [];
  const pdrs = [];
  const providers = [];

  range(20).map((num) => (
    collections.push(fakeCollectionRecordFactory({
      name: `testCollection___${num}`,
      cumulus_id: num,
    }))
  ));

  range(10).map((num) => (
    providers.push(fakeProviderRecordFactory({
      cumulus_id: num,
      name: `testProvider${num}`,
    }))
  ));

  range(100).map((num) => (
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
    pdrs.push(fakePdrRecordFactory({
      collection_cumulus_id: num,
      status: statuses[(num % 3) + 1],
      provider_cumulus_id: num % 10,
      created_at: (new Date(2018 + (num % 6), (num % 12), (num % 30))).toISOString(),
      updated_at: (new Date(2018 + (num % 6), (num % 12), ((num + 1) % 29))).toISOString(),
    // eslint-disable-next-line no-sequences
    })),
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
  const AggregateSearch = new StatsSearch({ queryStringParameters }, 'granule');
  const results = await AggregateSearch.aggregate(knex);
  const expectedResponse = [
    { key: 'completed', count: 25 },
    { key: 'failed', count: 25 },
    { key: 'queued', count: 25 },
    { key: 'running', count: 25 },
  ];
  t.is(results.meta.count, 100);
  t.deepEqual(results.count, expectedResponse);
});

test('StatsSearch filters correctly by date', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    type: 'granules',
    timestamp__from: `${(new Date(2020, 1, 28)).getTime()}`,
    timestamp__to: `${(new Date(2022, 2, 30)).getTime()}`,
  };

  const AggregateSearch = new StatsSearch({ queryStringParameters }, 'granule');
  const results = await AggregateSearch.aggregate(knex);
  const expectedResponse = [
    { key: 'completed', count: 9 },
    { key: 'running', count: 9 },
    { key: 'failed', count: 8 },
    { key: 'queued', count: 8 },
  ];
  t.is(results.meta.count, 34);
  t.deepEqual(results.count, expectedResponse);
});

test('StatsSearch filters executions correctly', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    type: 'executions',
    field: 'status',
  };

  const AggregateSearch = new StatsSearch({ queryStringParameters }, 'execution');
  const results = await AggregateSearch.aggregate(knex);
  const expectedResponse1 = [
    { key: 'completed', count: 7 },
    { key: 'failed', count: 7 },
    { key: 'running', count: 6 },
  ];
  t.is(results.meta.count, 20);
  t.deepEqual(results.count, expectedResponse1);

  queryStringParameters = {
    type: 'executions',
    field: 'status',
    timestamp__to: `${(new Date(2023, 11, 30)).getTime()}`,
    timestamp__from: `${(new Date(2021, 1, 28)).getTime()}`,
  };

  const AggregateSearch2 = new StatsSearch({ queryStringParameters }, 'execution');
  const results2 = await AggregateSearch2.aggregate(knex);
  const expectedResponse2 = [
    { key: 'completed', count: 3 },
    { key: 'failed', count: 3 },
    { key: 'running', count: 3 },
  ];
  t.is(results2.meta.count, 9);
  t.deepEqual(results2.count, expectedResponse2);

  queryStringParameters = {
    type: 'executions',
    field: 'status',
    timestamp__to: `${(new Date(2023, 11, 30)).getTime()}`,
    timestamp__from: `${(new Date(2021, 1, 28)).getTime()}`,
    collectionId: 'testCollection___5',
    status: 'running',
  };

  const AggregateSearch3 = new StatsSearch({ queryStringParameters }, 'execution');
  const results3 = await AggregateSearch3.aggregate(knex);
  const expectedResponse3 = [{ key: 'running', count: 1 }];
  t.deepEqual(results3.count, expectedResponse3);
  t.is(results3.meta.count, 1);
});

test('StatsSearch filters PDRs correctly', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    type: 'pdrs',
    field: 'status',
  };

  const AggregateSearch = new StatsSearch({ queryStringParameters }, 'pdr');
  const results = await AggregateSearch.aggregate(knex);
  const expectedResponse = [
    { key: 'completed', count: 7 },
    { key: 'failed', count: 7 },
    { key: 'running', count: 6 },
  ];
  t.is(results.meta.count, 20);
  t.deepEqual(results.count, expectedResponse);

  queryStringParameters = {
    type: 'pdrs',
    field: 'status',
    timestamp__to: `${(new Date(2019, 12, 9)).getTime()}`,
    timestamp__from: `${(new Date(2018, 1, 28)).getTime()}`,
  };

  const AggregateSearch2 = new StatsSearch({ queryStringParameters }, 'pdr');
  const results2 = await AggregateSearch2.aggregate(knex);
  const expectedResponse2 = [{ key: 'completed', count: 4 }, { key: 'failed', count: 2 }];
  t.is(results2.meta.count, 6);
  t.deepEqual(results2.count, expectedResponse2);

  queryStringParameters = {
    type: 'pdrs',
    field: 'status',
    timestamp__to: `${(new Date(2019, 12, 9)).getTime()}`,
    timestamp__from: `${(new Date(2018, 1, 28)).getTime()}`,
    status: 'failed',
  };

  const AggregateSearch3 = new StatsSearch({ queryStringParameters }, 'pdr');
  const results3 = await AggregateSearch3.aggregate(knex);
  const expectedResponse3 = [{ key: 'failed', count: 2 }];
  t.is(results3.meta.count, 2);
  t.deepEqual(results3.count, expectedResponse3);
});

test('StatsSearch returns correct response when queried by provider', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    type: 'granules',
    field: 'status',
    provider: 'testProvider2',
  };

  const AggregateSearch = new StatsSearch({ queryStringParameters }, 'granule');
  const results = await AggregateSearch.aggregate(knex);
  const expectedResponse = [{ key: 'completed', count: 5 }, { key: 'queued', count: 5 }];
  t.is(results.meta.count, 10);
  t.deepEqual(results.count, expectedResponse);
});

test('StatsSearch returns correct response when queried by collection', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    type: 'granules',
    field: 'status',
    collectionId: 'testCollection___8',
  };

  const AggregateSearch = new StatsSearch({ queryStringParameters }, 'granule');
  const results = await AggregateSearch.aggregate(knex);
  const expectedResponse = [{ key: 'queued', count: 5 }];
  t.is(results.meta.count, 5);
  t.deepEqual(results.count, expectedResponse);
});

test('StatsSearch returns correct response when queried by collection and provider', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    type: 'granules',
    field: 'status',
    collectionId: 'testCollection___1',
    providerId: 'testProvider1',
  };

  const AggregateSearch = new StatsSearch({ queryStringParameters }, 'granule');
  const results = await AggregateSearch.aggregate(knex);
  const expectedResponse = [{ key: 'failed', count: 5 }];
  t.is(results.meta.count, 5);
  t.deepEqual(results.count, expectedResponse);

  queryStringParameters = {
    type: 'granules',
    field: 'status',
    collectionId: 'testCollection___1',
    providerId: 'testProvider1',
    timestamp__to: `${(new Date(2019, 12, 9)).getTime()}`,
    timestamp__from: `${(new Date(2018, 1, 28)).getTime()}`,
  };

  const AggregateSearch2 = new StatsSearch({ queryStringParameters }, 'granule');
  const results2 = await AggregateSearch2.aggregate(knex);
  const expectedResponse2 = [{ key: 'failed', count: 2 }];
  t.is(results2.meta.count, 2);
  t.deepEqual(results2.count, expectedResponse2);
  queryStringParameters = {
    type: 'granules',
    field: 'status',
    collectionId: 'testCollection___1',
    providerId: 'testProvider1',
    timestamp__to: `${(new Date(2019, 12, 9)).getTime()}`,
    timestamp__from: `${(new Date(2018, 1, 28)).getTime()}`,
    status: 'failed',
  };

  const AggregateSearch3 = new StatsSearch({ queryStringParameters }, 'granule');
  const results3 = await AggregateSearch3.aggregate(knex);
  const expectedResponse3 = [{ key: 'failed', count: 2 }];
  t.is(results3.meta.count, 2);
  t.deepEqual(results3.count, expectedResponse3);
});

test('StatsSearch returns correct response when queried by error', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    type: 'granules',
    field: 'error.Error.keyword',
  };
  const AggregateSearch = new StatsSearch({ queryStringParameters }, 'granule');
  const results = await AggregateSearch.aggregate(knex);
  const expectedResponse1 = [
    { key: 'CmrFailure', count: 20 },
    { key: 'CumulusMessageAdapterError', count: 20 },
    { key: 'IngestFailure', count: 20 },
    { key: 'UnknownError', count: 20 },
    { key: '{}', count: 20 },
  ];
  t.is(results.meta.count, 100);
  t.deepEqual(results.count, expectedResponse1);

  queryStringParameters = {
    type: 'granules',
    field: 'error.Error.keyword',
    timestamp__to: `${(new Date(2021, 12, 9)).getTime()}`,
    timestamp__from: `${(new Date(2020, 1, 28)).getTime()}`,
  };
  const AggregateSearch2 = new StatsSearch({ queryStringParameters }, 'granule');
  const results2 = await AggregateSearch2.aggregate(knex);
  const expectedResponse2 = [
    { key: 'CmrFailure', count: 8 },
    { key: 'IngestFailure', count: 7 },
    { key: '{}', count: 7 },
    { key: 'CumulusMessageAdapterError', count: 6 },
    { key: 'UnknownError', count: 6 },
  ];
  t.is(results2.meta.count, 34);
  t.deepEqual(results2.count, expectedResponse2);

  queryStringParameters = {
    type: 'granules',
    collectionId: 'testCollection___1',
    providerId: 'testProvider1',
    field: 'error.Error.keyword',
    timestamp__to: `${(new Date(2019, 12, 9)).getTime()}`,
    timestamp__from: `${(new Date(2018, 1, 28)).getTime()}`,
  };
  const AggregateSearch3 = new StatsSearch({ queryStringParameters }, 'granule');
  const results3 = await AggregateSearch3.aggregate(knex);
  const expectedResponse3 = [{ key: 'CumulusMessageAdapterError', count: 2 }];
  t.is(results3.meta.count, 2);
  t.deepEqual(results3.count, expectedResponse3);
});

test('StatsSearch can query by infix and prefix when type is defined', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    type: 'granules',
    infix: 'testGra',
  };
  const AggregateSearch = new StatsSearch({ queryStringParameters }, 'granule');
  const results = await AggregateSearch.aggregate(knex);
  const expectedResponse1 = [{ key: 'completed', count: 25 }, { key: 'queued', count: 25 }];
  t.is(results.meta.count, 50);
  t.deepEqual(results.count, expectedResponse1);

  queryStringParameters = {
    type: 'granules',
    prefix: 'query',
  };
  const AggregateSearch2 = new StatsSearch({ queryStringParameters }, 'granule');
  const results2 = await AggregateSearch2.aggregate(knex);
  const expectedResponse2 = [{ key: 'failed', count: 25 }, { key: 'running', count: 25 }];
  t.is(results2.meta.count, 50);
  t.deepEqual(results2.count, expectedResponse2);

  queryStringParameters = {
    type: 'collections',
    infix: 'testCollection___8',
    field: 'name',
  };
  const AggregateSearch3 = new StatsSearch({ queryStringParameters }, 'collection');
  const results3 = await AggregateSearch3.aggregate(knex);
  const expectedResponse3 = [{ key: 'testCollection___8', count: 1 }];
  t.is(results3.meta.count, 1);
  t.deepEqual(results3.count, expectedResponse3);
});

test('StatsSummary works', async (t) => {
  const { knex } = t.context;
  const StatsSummary = new StatsSearch({}, 'granule');
  const results = await StatsSummary.summary(knex);
  t.is(results.collections.value, 20);
  t.is(results.granules.value, 100);
  t.is(results.errors.value, 80);
  t.is(results.processingTime.value, 54.44999999642372);
  const queryStringParameters = {
    timestamp__to: `${(new Date(2019, 12, 9)).getTime()}`,
    timestamp__from: `${(new Date(2018, 1, 28)).getTime()}`,
  };
  const StatsSummary2 = new StatsSearch({ queryStringParameters }, 'granule');
  const results2 = await StatsSummary2.summary(knex);
  t.is(results2.collections.value, 15);
  t.is(results2.granules.value, 25);
  t.is(results2.errors.value, 21);
  t.is(results2.processingTime.value, 53.54799992084503);
});

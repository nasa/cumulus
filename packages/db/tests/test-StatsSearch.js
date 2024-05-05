'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
//const { randomId } = require('@cumulus/common/test-utils');
const range = require('lodash/range');
const { StatsSearch } = require('../dist/search/StatsSearch');

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
} = require('../dist');

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
  const errors = [{ Error: { keyword: 'UnknownError' } }, { Error: { keyword: 'CumulusMessageAdapterError' } }, { Error: { keyword: 'IngestFailure' } }, { Error: { keyword: 'CmrFailure' } }];
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
      status: statuses[num % 4],
      beginning_date_time: (new Date(2018 + (num % 6), (num % 12), (num % 30))).toISOString(),
      ending_date_time: (new Date(2018 + (num % 6), (num % 12), ((num + 1) % 29))).toISOString(),
      error: errors[num % 4],
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
      error: errors[num % 4],
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
  const AggregateSearch = new StatsSearch('/stats/aggregate?type=granules');

  const expectedResponse = [
    { status: 'completed', count: '25' },
    { status: 'running', count: '25' },
    { status: 'queued', count: '25' },
    { status: 'failed', count: '25' },
  ];

  t.deepEqual(await AggregateSearch.aggregate_search(knex), expectedResponse);
});

test('StatsSearch filters correctly by date', async (t) => {
  const { knex } = t.context;
  const AggregateSearch = new StatsSearch(`/stats/aggregate?type=granules&timestamp__from=${(new Date(2020, 1, 28)).getTime()}&timestamp__to=${(new Date(2022, 2, 30)).getTime()}`);

  const expectedResponse = [
    { status: 'completed', count: '9' },
    { status: 'running', count: '9' },
    { status: 'failed', count: '8' },
    { status: 'queued', count: '8' },
  ];

  t.deepEqual(await AggregateSearch.aggregate_search(knex), expectedResponse);
});

test('StatsSearch filters executions correctly', async (t) => {
  const { knex } = t.context;
  const AggregateSearch = new StatsSearch('/stats/aggregate?type=executions&field=status');
  const expectedResponse = [
    { status: 'completed', count: '7' },
    { status: 'failed', count: '7' },
    { status: 'running', count: '6' },
  ];

  const AggregateSearch2 = new StatsSearch(`/stats/aggregate?type=executions&field=status&timestamp__from=${(new Date(2021, 1, 28)).getTime()}&timestamp__to=${(new Date(2023, 11, 30)).getTime()}`);
  const expectedResponse2 = [
    { status: 'completed', count: '3' },
    { status: 'failed', count: '3' },
    { status: 'running', count: '3' },
  ];

  const AggregateSearch3 = new StatsSearch(`/stats/aggregate?type=executions&field=status&timestamp__from=${(new Date(2021, 1, 28)).getTime()}&timestamp__to=${(new Date(2023, 11, 30)).getTime()}&collectionId=testCollection5`);
  const expectedResponse3 = [{ status: 'running', count: '1' }];

  const AggregateSearch4 = new StatsSearch(`/stats/aggregate?type=executions&field=status&timestamp__from=${(new Date(2021, 1, 28)).getTime()}&timestamp__to=${(new Date(2023, 11, 30)).getTime()}&collectionId=testCollection5&status=running`);
  const expectedResponse4 = [{ count: '1' }];

  t.deepEqual(await AggregateSearch.aggregate_search(knex), expectedResponse);
  t.deepEqual(await AggregateSearch2.aggregate_search(knex), expectedResponse2);
  t.deepEqual(await AggregateSearch3.aggregate_search(knex), expectedResponse3);
  t.deepEqual(await AggregateSearch4.aggregate_search(knex), expectedResponse4);
});

test('StatsSearch filters PDRs correctly', async (t) => {
  const { knex } = t.context;
  const AggregateSearch = new StatsSearch('/stats/aggregate?type=pdrs&field=status');
  const expectedResponse = [
    { status: 'completed', count: '7' },
    { status: 'failed', count: '7' },
    { status: 'running', count: '6' },
  ];

  const AggregateSearch2 = new StatsSearch(`/stats/aggregate?type=pdrs&field=status&timestamp__from=${(new Date(2018, 1, 28)).getTime()}&timestamp__to=${(new Date(2019, 12, 9)).getTime()}`);
  const expectedResponse2 = [
    { status: 'completed', count: '4' },
    { status: 'failed', count: '2' },
  ];

  const AggregateSearch3 = new StatsSearch(`/stats/aggregate?type=pdrs&field=status&timestamp__from=${(new Date(2018, 1, 28)).getTime()}&timestamp__to=${(new Date(2019, 12, 9)).getTime()}&status=failed`);
  const expectedResponse3 = [{ count: '2' }];
  t.deepEqual(await AggregateSearch.aggregate_search(knex), expectedResponse);
  t.deepEqual(await AggregateSearch2.aggregate_search(knex), expectedResponse2);
  t.deepEqual(await AggregateSearch3.aggregate_search(knex), expectedResponse3);
});

test('StatsSearch returns correct response when queried by provider', async (t) => {
  const { knex } = t.context;
  const expectedResponse = [
    { status: 'completed', count: '5' },
    { status: 'queued', count: '5' },
  ];
  const AggregateSearch = new StatsSearch('/stats/aggregate?type=granules&field=status&providerId=testProvider2');
  t.deepEqual(await AggregateSearch.aggregate_search(knex), expectedResponse);
});

test('StatsSearch returns correct response when queried by collection', async (t) => {
  const { knex } = t.context;
  const expectedResponse = [{ status: 'queued', count: '5' }];
  const AggregateSearch = new StatsSearch('/stats/aggregate?type=granules&field=status&collectionId=testCollection8');
  t.deepEqual(await AggregateSearch.aggregate_search(knex), expectedResponse);
});

test('StatsSearch returns correct response when queried by collection and provider', async (t) => {
  const { knex } = t.context;
  const expectedResponse = [{ status: 'failed', count: '5' }];
  const AggregateSearch = new StatsSearch('/stats/aggregate?type=granules&field=status&collectionId=testCollection1&providerId=testProvider1');

  const expectedResponse2 = [{ status: 'failed', count: '2' }];
  const AggregateSearch2 = new StatsSearch(`/stats/aggregate?type=granules&field=status&collectionId=testCollection1&providerId=testProvider1&timestamp__from=${(new Date(2018, 1, 28)).getTime()}&timestamp__to=${(new Date(2019, 12, 9)).getTime()}`);

  const expectedResponse3 = [{ count: '2' }];
  const AggregateSearch3 = new StatsSearch(`/stats/aggregate?type=granules&field=status&collectionId=testCollection1&providerId=testProvider1&timestamp__from=${(new Date(2018, 1, 28)).getTime()}&timestamp__to=${(new Date(2019, 12, 9)).getTime()}&status=failed`);
  t.deepEqual(await AggregateSearch.aggregate_search(knex), expectedResponse);
  t.deepEqual(await AggregateSearch2.aggregate_search(knex), expectedResponse2);
  t.deepEqual(await AggregateSearch3.aggregate_search(knex), expectedResponse3);
});

test('StatsSearch returns correct response when queried by error', async (t) => {
  const { knex } = t.context;
  const AggregateSearch = new StatsSearch('/stats/aggregate?type=granules&field=error.Error.keyword');

  const expectedResponse = [
    { error: 'CumulusMessageAdapterError', count: '25' },
    { error: 'CmrFailure', count: '25' },
    { error: 'UnknownError', count: '25' },
    { error: 'IngestFailure', count: '25' },
  ];

  t.deepEqual(await AggregateSearch.aggregate_search(knex), expectedResponse);

  const AggregateSearch2 = new StatsSearch(`/stats/aggregate?type=granules&field=error.Error.keyword&timestamp__from=${(new Date(2020, 1, 28)).getTime()}&timestamp__to=${(new Date(2021, 12, 9)).getTime()}`);
  const expectedResponse2 = [
    { error: 'CmrFailure', count: '9' },
    { error: 'IngestFailure', count: '9' },
    { error: 'CumulusMessageAdapterError', count: '8' },
    { error: 'UnknownError', count: '8' },
  ];

  t.deepEqual(await AggregateSearch2.aggregate_search(knex), expectedResponse2);
});

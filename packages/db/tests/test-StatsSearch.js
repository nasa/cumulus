'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
//const { randomId } = require('@cumulus/common/test-utils');
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

  const collection1 = fakeCollectionRecordFactory({ name: 'testCollection', version: 'v3' });
  const collection2 = fakeCollectionRecordFactory({ name: 'testCollection2', version: 'v2' });
  const collection3 = fakeCollectionRecordFactory({ name: 'testCollection3', version: 'v1' });

  const pgCollections = await t.context.collectionPgModel.insert(
    t.context.knex,
    [collection1, collection2, collection3],
    '*'
  );

  const statuses = ['queued', 'failed', 'completed', 'running'];
  const errors = [{ Error: { keyword: 'UnknownError' } }, { Error: { keyword: 'CumulusMessageAdapterError' } }, { Error: { keyword: 'IngestFailure' } }, { Error: { keyword: 'CmrFailure' } }];
  const granules = [];
  const executions = [];
  const pdrs = [];
  const providers = [];

  for (let i = 0; i < 10; i += 1) {
    granules.push(fakeGranuleRecordFactory({
      collection_cumulus_id: pgCollections[i % 3].cumulus_id,
      status: statuses[i % 4],
      beginning_date_time: (new Date(2019, 0, 28)).toISOString(),
      ending_date_time: (new Date(2024, 5, 30)).toISOString(),
      error: errors[i % 4],
      provider_cumulus_id: i % 4,
    }));

    pdrs.push(fakePdrRecordFactory({
      collection_cumulus_id: pgCollections[i % 3].cumulus_id,
      status: statuses[(i % 3) + 1],
      provider_cumulus_id: i % 10,
      created_at: (new Date(2018, 1, 28)).toISOString(),
      updated_at: (new Date(2024, 5, 30)).toISOString(),
    }));

    executions.push(fakeExecutionRecordFactory({
      collection_cumulus_id: pgCollections[i % 3].cumulus_id,
      status: statuses[(i % 3) + 1],
      error: errors[i % 4],
      created_at: (new Date(2019, 1, 28)).toISOString(),
      updated_at: (new Date(2024, 5, 30)).toISOString(),
    }));

    providers.push(fakeProviderRecordFactory({
      cumulus_id: i % 10,
      name: `testProvider${i % 10}`,
    }));
  }

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

test('StatsSearch returns correct response using', async (t) => {
  const { knex } = t.context;
  const AggregateSearch = new StatsSearch('/stats/aggregate?type=granules');

  const expectedResponse = [
    { status: 'queued', count: '3' },
    { status: 'failed', count: '3' },
    { status: 'completed', count: '2' },
    { status: 'running', count: '2' },
  ];

  t.deepEqual(await AggregateSearch.aggregate_search(knex), expectedResponse);
});

test('StatsSearch filters correctly by date', async (t) => {
  const { knex } = t.context;
  const AggregateSearch = new StatsSearch(`/stats/aggregate?type=granules&timestamp__from=${(new Date(2020, 0, 28)).getTime()}&timestamp__to=${(new Date(2024, 2, 30)).getTime()}`);

  const expectedResponse = [
    { status: 'queued', count: '3' },
    { status: 'failed', count: '3' },
    { status: 'running', count: '2' },
    { status: 'completed', count: '2' },
  ];

  t.deepEqual(await AggregateSearch.aggregate_search(knex), expectedResponse);
});

test('StatsSearch filters executions correctly', async (t) => {
  const { knex } = t.context;
  const AggregateSearch = new StatsSearch('/stats/aggregate?type=executions&field=status');

  const expectedResponse = [
    { count: '4', status: 'failed' },
    { count: '3', status: 'completed' },
    { count: '3', status: 'running' },
  ];
  const AggregateSearch2 = new StatsSearch(`/stats/aggregate?type=executions&field=status&timestamp__from=${(new Date(2020, 0, 28)).getTime()}&timestamp__to=${(new Date(2024, 2, 30)).getTime()}`);

  const expectedResponse2 = [
    { status: 'failed', count: '4' },
    { status: 'running', count: '3' },
    { status: 'completed', count: '3' },
  ];

  t.deepEqual(await AggregateSearch2.aggregate_search(knex), expectedResponse2);
  t.deepEqual(await AggregateSearch.aggregate_search(knex), expectedResponse);
});

test('StatsSearch filters PDRs correctly', async (t) => {
  const { knex } = t.context;
  const AggregateSearch = new StatsSearch('/stats/aggregate?type=pdrs&field=status');

  const expectedResponse = [
    { status: 'failed', count: '4' },
    { status: 'completed', count: '3' },
    { status: 'running', count: '3' },
  ];

  const AggregateSearch2 = new StatsSearch(`/stats/aggregate?type=pdrs&field=status&timestamp__from=${(new Date(2020, 0, 28)).getTime()}&timestamp__to=${(new Date(2024, 2, 30)).getTime()}`);

  const expectedResponse2 = [
    { status: 'failed', count: '4' },
    { status: 'running', count: '3' },
    { status: 'completed', count: '3' },
  ];

  t.deepEqual(await AggregateSearch2.aggregate_search(knex), expectedResponse2);
  t.deepEqual(await AggregateSearch.aggregate_search(knex), expectedResponse);
});

test('StatsSearch returns correct response when queried by provider', async (t) => {
  const { knex } = t.context;
  const expectedResponse = [{ status: 'completed', count: '2' }];
  const AggregateSearch = new StatsSearch('/stats/aggregate?type=granules&field=status&providerId=testProvider2');
  t.deepEqual(await AggregateSearch.aggregate_search(knex), expectedResponse);
});

test('StatsSearch returns correct response when queried by collection', async (t) => {
  const { knex } = t.context;
  const expectedResponse = [
    { status: 'completed', count: '1' },
    { status: 'failed', count: '1' },
    { status: 'queued', count: '1' },
    { status: 'running', count: '1' },
  ];
  const AggregateSearch = new StatsSearch('/stats/aggregate?type=granules&field=status&collectionId=testCollection');
  t.deepEqual(await AggregateSearch.aggregate_search(knex), expectedResponse);
});

test('StatsSearch returns correct response when queried by collection and provider', async (t) => {
  const { knex } = t.context;
  const expectedResponse = [
    { status: 'completed', count: '1' },
  ];
  const AggregateSearch = new StatsSearch('/stats/aggregate?type=granules&field=status&collectionId=testCollection&providerId=testProvider2');
  t.deepEqual(await AggregateSearch.aggregate_search(knex), expectedResponse);
});

test('StatsSearch returns correct response when queried by error', async (t) => {
  const { knex } = t.context;
  const AggregateSearch = new StatsSearch('/stats/aggregate?type=granules&field=error.Error.keyword');

  const expectedResponse = [
    { error: 'CumulusMessageAdapterError', count: '3' },
    { error: 'UnknownError', count: '3' },
    { error: 'CmrFailure', count: '2' },
    { error: 'IngestFailure', count: '2' },
  ];

  t.deepEqual(await AggregateSearch.aggregate_search(knex), expectedResponse);
});

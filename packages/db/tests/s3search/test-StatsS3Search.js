'use strict';

const test = require('ava');
const knex = require('knex');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');
const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const {
  createDuckDBTables,
  setupDuckDBWithS3ForTesting,
  stageAndLoadDuckDBTableFromData,
} = require('../../dist/test-duckdb-utils');
const {
  collectionsS3TableSql,
  executionsS3TableSql,
  granulesS3TableSql,
  providersS3TableSql,
  pdrsS3TableSql,
  reconciliationReportsS3TableSql,
} = require('../../dist/s3search/s3TableSchemas');

const {
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  fakePdrRecordFactory,
  fakeProviderRecordFactory,
  fakeExecutionRecordFactory,
  fakeReconciliationReportRecordFactory,
} = require('../../dist');

const { StatsS3Search } = require('../../dist/s3search/StatsS3Search');

test.before(async (t) => {
  t.context.knexBuilder = knex({ client: 'pg' });

  const statuses = ['queued', 'failed', 'completed', 'running'];
  const errors = [{ Error: 'UnknownError' }, { Error: 'CumulusMessageAdapterError' }, { Error: 'IngestFailure' }, { Error: 'CmrFailure' }, {}];
  const reconReportTypes = ['Granule Inventory', 'Granule Not Found', 'Inventory', 'ORCA Backup'];
  const reconReportStatuses = ['Generated', 'Pending', 'Failed'];

  const collections = range(20).map((num) => fakeCollectionRecordFactory({
    name: 'testCollection',
    version: `${num}`,
    cumulus_id: num,
  }));

  const providers = range(10).map((num) => fakeProviderRecordFactory({
    cumulus_id: num,
    name: `testProvider${num}`,
  }));

  const granules = range(100).map((num) => fakeGranuleRecordFactory({
    cumulus_id: num,
    collection_cumulus_id: num % 20,
    granule_id: num % 2 === 0 ? `testGranule${num}` : `query__Granule${num}`,
    status: statuses[num % 4],
    created_at: (new Date(2018 + (num % 6), (num % 12), (num % 30))),
    updated_at: (new Date(2018 + (num % 6), (num % 12), ((num + 1) % 29))),
    error: errors[num % 5],
    duration: num + (num / 10),
    provider_cumulus_id: num % 10,
  }));

  const pdrs = range(20).map((num) => fakePdrRecordFactory({
    cumulus_id: num,
    collection_cumulus_id: num,
    status: statuses[(num % 3) + 1],
    provider_cumulus_id: num % 10,
    created_at: (new Date(2018 + (num % 6), (num % 12), (num % 30))),
    updated_at: (new Date(2018 + (num % 6), (num % 12), ((num + 1) % 29))),
  }));

  const executions = range(20).map((num) => fakeExecutionRecordFactory({
    cumulus_id: num,
    collection_cumulus_id: num,
    status: statuses[(num % 3) + 1],
    error: errors[num % 5],
    created_at: (new Date(2018 + (num % 6), (num % 12), (num % 30))),
    updated_at: (new Date(2018 + (num % 6), (num % 12), ((num + 1) % 29))),
  }));

  const reconReports = range(24).map((num) => fakeReconciliationReportRecordFactory({
    cumulus_id: num,
    type: reconReportTypes[(num % 4)],
    status: reconReportStatuses[(num % 3)],
    created_at: (new Date(2024 + (num % 6), (num % 12), (num % 30))),
    updated_at: (new Date(2024 + (num % 6), (num % 12), ((num + 1) % 29))),
  }));

  const { instance, connection } = await setupDuckDBWithS3ForTesting();
  t.context.instance = instance;
  t.context.connection = connection;

  t.context.testBucket = cryptoRandomString({ length: 10 });
  await s3().createBucket({ Bucket: t.context.testBucket });
  await createDuckDBTables(connection);

  const duckdbS3Prefix = `s3://${t.context.testBucket}/duckdb/`;

  console.log('create collections');
  await stageAndLoadDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'collections',
    collectionsS3TableSql,
    collections,
    `${duckdbS3Prefix}collections.parquet`
  );

  console.log('create providers');
  await stageAndLoadDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'providers',
    providersS3TableSql,
    providers,
    `${duckdbS3Prefix}providers.parquet`
  );

  console.log('create granules');
  await stageAndLoadDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'granules',
    granulesS3TableSql,
    granules,
    `${duckdbS3Prefix}granules.parquet`
  );

  console.log('create executions');
  await stageAndLoadDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'executions',
    executionsS3TableSql,
    executions,
    `${duckdbS3Prefix}executions.parquet`
  );

  console.log('create pdrs');
  await stageAndLoadDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'pdrs',
    pdrsS3TableSql,
    pdrs,
    `${duckdbS3Prefix}pdrs.parquet`
  );

  console.log('create reconciliation_reports');
  await stageAndLoadDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'reconciliation_reports',
    reconciliationReportsS3TableSql,
    reconReports,
    `${duckdbS3Prefix}reconciliation_reports.parquet`
  );
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.testBucket);
  await t.context.connection.closeSync();
});

test.serial('StatsS3Search aggregate returns correct response for basic query with type granules', async (t) => {
  const { connection } = t.context;
  const AggregateSearch = new StatsS3Search({}, 'granule', connection);
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

test.serial('StatsS3Search aggregate filters granules correctly by date', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    timestamp__from: `${(new Date(2020, 1, 28)).getTime()}`,
    timestamp__to: `${(new Date(2022, 2, 30)).getTime()}`,
  };

  const AggregateSearch = new StatsS3Search({ queryStringParameters }, 'granule', connection);
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

test.serial('StatsS3Search aggregate filters executions correctly', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    field: 'status',
  };

  const AggregateSearch = new StatsS3Search({ queryStringParameters }, 'execution', connection);
  const results = await AggregateSearch.aggregate(knex);
  const expectedResponse1 = [
    { key: 'completed', count: 7 },
    { key: 'failed', count: 7 },
    { key: 'running', count: 6 },
  ];
  t.is(results.meta.count, 20);
  t.deepEqual(results.count, expectedResponse1);

  queryStringParameters = {
    field: 'status',
    timestamp__to: `${(new Date(2023, 11, 30)).getTime()}`,
    timestamp__from: `${(new Date(2021, 1, 28)).getTime()}`,
  };

  const AggregateSearch2 = new StatsS3Search({ queryStringParameters }, 'execution', connection);
  const results2 = await AggregateSearch2.aggregate(knex);
  const expectedResponse2 = [
    { key: 'completed', count: 3 },
    { key: 'failed', count: 3 },
    { key: 'running', count: 3 },
  ];
  t.is(results2.meta.count, 9);
  t.deepEqual(results2.count, expectedResponse2);

  queryStringParameters = {
    field: 'status',
    timestamp__to: `${(new Date(2023, 11, 30)).getTime()}`,
    timestamp__from: `${(new Date(2021, 1, 28)).getTime()}`,
    collectionId: 'testCollection___5',
    status: 'running',
  };

  const AggregateSearch3 = new StatsS3Search({ queryStringParameters }, 'execution', connection);
  const results3 = await AggregateSearch3.aggregate(knex);
  const expectedResponse3 = [{ key: 'running', count: 1 }];
  t.deepEqual(results3.count, expectedResponse3);
  t.is(results3.meta.count, 1);
});

test.serial('StatsS3Search aggregate filters PDRs correctly', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    field: 'status',
  };

  const AggregateSearch = new StatsS3Search({ queryStringParameters }, 'pdr', connection);
  const results = await AggregateSearch.aggregate(knex);
  const expectedResponse = [
    { key: 'completed', count: 7 },
    { key: 'failed', count: 7 },
    { key: 'running', count: 6 },
  ];
  t.is(results.meta.count, 20);
  t.deepEqual(results.count, expectedResponse);

  queryStringParameters = {
    field: 'status',
    timestamp__to: `${(new Date(2019, 12, 9)).getTime()}`,
    timestamp__from: `${(new Date(2018, 1, 28)).getTime()}`,
  };

  const AggregateSearch2 = new StatsS3Search({ queryStringParameters }, 'pdr', connection);
  const results2 = await AggregateSearch2.aggregate(knex);
  const expectedResponse2 = [{ key: 'completed', count: 4 }, { key: 'failed', count: 2 }];
  t.is(results2.meta.count, 6);
  t.deepEqual(results2.count, expectedResponse2);

  queryStringParameters = {
    field: 'status',
    timestamp__to: `${(new Date(2019, 12, 9)).getTime()}`,
    timestamp__from: `${(new Date(2018, 1, 28)).getTime()}`,
    status: 'failed',
  };

  const AggregateSearch3 = new StatsS3Search({ queryStringParameters }, 'pdr', connection);
  const results3 = await AggregateSearch3.aggregate(knex);
  const expectedResponse3 = [{ key: 'failed', count: 2 }];
  t.is(results3.meta.count, 2);
  t.deepEqual(results3.count, expectedResponse3);
});

test.serial('StatsS3Search aggregate filters Reconciliation Reports correctly', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    field: 'type',
  };

  const AggregateSearch = new StatsS3Search({ queryStringParameters }, 'reconciliationReport', connection);
  const results = await AggregateSearch.aggregate(knex);
  const expectedResponse = [
    { key: 'Granule Inventory', count: 6 },
    { key: 'Granule Not Found', count: 6 },
    { key: 'Inventory', count: 6 },
    { key: 'ORCA Backup', count: 6 },
  ];
  t.is(results.meta.count, 24);
  t.deepEqual(results.count, expectedResponse);

  queryStringParameters = {
    field: 'status',
  };

  const AggregateSearch2 = new StatsS3Search({ queryStringParameters }, 'reconciliationReport', connection);
  const results2 = await AggregateSearch2.aggregate(knex);
  const expectedResponse2 = [
    { key: 'Failed', count: 8 },
    { key: 'Generated', count: 8 },
    { key: 'Pending', count: 8 },
  ];
  t.is(results2.meta.count, 24);
  t.deepEqual(results2.count, expectedResponse2);
});

test.serial('StatsS3Search returns correct aggregate response for type granule when queried by provider', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    field: 'status',
    provider: 'testProvider2',
  };

  const AggregateSearch = new StatsS3Search({ queryStringParameters }, 'granule', connection);
  const results = await AggregateSearch.aggregate(knex);
  const expectedResponse = [{ key: 'completed', count: 5 }, { key: 'queued', count: 5 }];
  t.is(results.meta.count, 10);
  t.deepEqual(results.count, expectedResponse);
});

test.serial('StatsS3Search returns correct aggregate response for type granule when queried by collection', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    field: 'status',
    collectionId: 'testCollection___8',
  };

  const AggregateSearch = new StatsS3Search({ queryStringParameters }, 'granule', connection);
  const results = await AggregateSearch.aggregate(knex);
  const expectedResponse = [{ key: 'queued', count: 5 }];
  t.is(results.meta.count, 5);
  t.deepEqual(results.count, expectedResponse);
});

test.serial('StatsS3Search returns correct aggregate response for type granule when queried by collection and provider', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    field: 'status',
    collectionId: 'testCollection___1',
    provider: 'testProvider1',
  };

  const AggregateSearch = new StatsS3Search({ queryStringParameters }, 'granule', connection);
  const results = await AggregateSearch.aggregate(knex);
  const expectedResponse = [{ key: 'failed', count: 5 }];
  t.is(results.meta.count, 5);
  t.deepEqual(results.count, expectedResponse);

  queryStringParameters = {
    field: 'status',
    collectionId: 'testCollection___1',
    provider: 'testProvider1',
    timestamp__to: `${(new Date(2019, 12, 9)).getTime()}`,
    timestamp__from: `${(new Date(2018, 1, 28)).getTime()}`,
  };

  const AggregateSearch2 = new StatsS3Search({ queryStringParameters }, 'granule', connection);
  const results2 = await AggregateSearch2.aggregate(knex);
  const expectedResponse2 = [{ key: 'failed', count: 2 }];
  t.is(results2.meta.count, 2);
  t.deepEqual(results2.count, expectedResponse2);
  queryStringParameters = {
    field: 'status',
    collectionId: 'testCollection___1',
    provider: 'testProvider1',
    timestamp__to: `${(new Date(2019, 12, 9)).getTime()}`,
    timestamp__from: `${(new Date(2018, 1, 28)).getTime()}`,
    status: 'failed',
  };

  const AggregateSearch3 = new StatsS3Search({ queryStringParameters }, 'granule', connection);
  const results3 = await AggregateSearch3.aggregate(knex);
  const expectedResponse3 = [{ key: 'failed', count: 2 }];
  t.is(results3.meta.count, 2);
  t.deepEqual(results3.count, expectedResponse3);
});

test.serial('StatsS3Search returns correct aggregate response for type granule when queried by error', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    field: 'error.Error.keyword',
  };
  const AggregateSearch = new StatsS3Search({ queryStringParameters }, 'granule', connection);
  const results = await AggregateSearch.aggregate(knex);
  const expectedResponse1 = [
    { key: 'CmrFailure', count: 20 },
    { key: 'CumulusMessageAdapterError', count: 20 },
    { key: 'IngestFailure', count: 20 },
    { key: 'UnknownError', count: 20 },
  ];
  t.is(results.meta.count, 80);
  t.deepEqual(results.count, expectedResponse1);

  queryStringParameters = {
    field: 'error.Error.keyword',
    timestamp__to: `${(new Date(2021, 12, 9)).getTime()}`,
    timestamp__from: `${(new Date(2020, 1, 28)).getTime()}`,
  };
  const AggregateSearch2 = new StatsS3Search({ queryStringParameters }, 'granule', connection);
  const results2 = await AggregateSearch2.aggregate(knex);
  const expectedResponse2 = [
    { key: 'CmrFailure', count: 8 },
    { key: 'IngestFailure', count: 7 },
    { key: 'CumulusMessageAdapterError', count: 6 },
    { key: 'UnknownError', count: 6 },
  ];
  t.is(results2.meta.count, 27);
  t.deepEqual(results2.count, expectedResponse2);

  queryStringParameters = {
    collectionId: 'testCollection___1',
    provider: 'testProvider1',
    field: 'error.Error.keyword',
    timestamp__to: `${(new Date(2019, 12, 9)).getTime()}`,
    timestamp__from: `${(new Date(2018, 1, 28)).getTime()}`,
  };
  const AggregateSearch3 = new StatsS3Search({ queryStringParameters }, 'granule', connection);
  const results3 = await AggregateSearch3.aggregate(knex);
  const expectedResponse3 = [{ key: 'CumulusMessageAdapterError', count: 2 }];
  t.is(results3.meta.count, 2);
  t.deepEqual(results3.count, expectedResponse3);
});

test.serial('StatsS3Search can query by infix and prefix when type is defined', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    infix: 'testGra',
  };
  const AggregateSearch = new StatsS3Search({ queryStringParameters }, 'granule', connection);
  const results = await AggregateSearch.aggregate(knex);
  const expectedResponse1 = [{ key: 'completed', count: 25 }, { key: 'queued', count: 25 }];
  t.is(results.meta.count, 50);
  t.deepEqual(results.count, expectedResponse1);

  queryStringParameters = {
    prefix: 'query',
  };
  const AggregateSearch2 = new StatsS3Search({ queryStringParameters }, 'granule', connection);
  const results2 = await AggregateSearch2.aggregate(knex);
  const expectedResponse2 = [{ key: 'failed', count: 25 }, { key: 'running', count: 25 }];
  t.is(results2.meta.count, 50);
  t.deepEqual(results2.count, expectedResponse2);

  queryStringParameters = {
    infix: 'testCollection',
    version: '8',
    field: 'name',
  };
  const AggregateSearch3 = new StatsS3Search({ queryStringParameters }, 'collection', connection);
  const results3 = await AggregateSearch3.aggregate(knex);
  const expectedResponse3 = [{ key: 'testCollection', count: 1 }];
  t.is(results3.meta.count, 1);
  t.deepEqual(results3.count, expectedResponse3);
});

test.serial('StatsS3Search summary works', async (t) => {
  const { connection } = t.context;
  const StatsSummary = new StatsS3Search({}, 'granule', connection);
  const results = await StatsSummary.summary(knex);
  t.is(results.collections.value, 20);
  t.is(results.granules.value, 100);
  t.is(results.errors.value, 80);
  t.is(results.processingTime.value, 54.44999999642372);
  const queryStringParameters = {
    timestamp__to: `${(new Date(2019, 12, 9)).getTime()}`,
    timestamp__from: `${(new Date(2018, 1, 28)).getTime()}`,
  };
  const StatsSummary2 = new StatsS3Search({ queryStringParameters }, 'granule', connection);
  const results2 = await StatsSummary2.summary(knex);
  t.is(results2.collections.value, 15);
  t.is(results2.granules.value, 25);
  t.is(results2.errors.value, 21);
  t.is(results2.processingTime.value, 53.54799992084503);
});

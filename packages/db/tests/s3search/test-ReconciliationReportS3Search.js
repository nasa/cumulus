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
  reconciliationReportsS3TableSql,
} = require('../../dist/s3search/s3TableSchemas');
const { ReconciliationReportS3Search } = require('../../dist/s3search/ReconciliationReportS3Search');
const {
  fakeReconciliationReportRecordFactory,
} = require('../../dist');

test.before(async (t) => {
  t.context.knexBuilder = knex({ client: 'pg' });

  const reconReportTypes = ['Granule Inventory', 'Granule Not Found', 'Inventory', 'ORCA Backup'];
  const reconReportStatuses = ['Generated', 'Pending', 'Failed'];
  t.context.reconReportSearchTimestamp = 1704100000000;
  t.context.reportBucket = cryptoRandomString({ length: 8 });
  t.context.reportKey = cryptoRandomString({ length: 8 });

  const reconReports = range(50).map((num) => fakeReconciliationReportRecordFactory({
    cumulus_id: num,
    name: `fakeReconReport-${num + 1}`,
    type: reconReportTypes[num % 4],
    status: reconReportStatuses[num % 3],
    location: `s3://fakeBucket${t.context.reportBucket}/fakeKey${t.context.reportKey}`,
    updated_at: new Date(t.context.reconReportSearchTimestamp + (num % 2)),
    created_at: new Date(t.context.reconReportSearchTimestamp - (num % 2)),
  }));

  const { instance, connection } = await setupDuckDBWithS3ForTesting();
  t.context.instance = instance;
  t.context.connection = connection;

  t.context.testBucket = cryptoRandomString({ length: 10 });
  await s3().createBucket({ Bucket: t.context.testBucket });
  await createDuckDBTables(connection);

  const duckdbS3Prefix = `s3://${t.context.testBucket}/duckdb/`;

  console.log('create reconciliation reports');
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

test.serial('ReconciliationReportS3Search returns the correct response for a basic query', async (t) => {
  const { connection } = t.context;
  const dbSearch = new ReconciliationReportS3Search({}, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results.length, 10);

  const expectedResponse1 = {
    name: 'fakeReconReport-1',
    type: 'Granule Inventory',
    status: 'Generated',
    location: `s3://fakeBucket${t.context.reportBucket}/fakeKey${t.context.reportKey}`,
    updatedAt: t.context.reconReportSearchTimestamp,
    createdAt: t.context.reconReportSearchTimestamp,
  };

  const expectedResponse10 = {
    name: 'fakeReconReport-10',
    type: 'Granule Not Found',
    status: 'Generated',
    location: `s3://fakeBucket${t.context.reportBucket}/fakeKey${t.context.reportKey}`,
    updatedAt: t.context.reconReportSearchTimestamp + 1,
    createdAt: t.context.reconReportSearchTimestamp - 1,
  };

  t.deepEqual(response.results[0], expectedResponse1);
  t.deepEqual(response.results[9], expectedResponse10);
});

test.serial('ReconciliationReportS3Search supports page and limit params', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 25,
    page: 2,
  };
  let dbSearch = new ReconciliationReportS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 10,
    page: 5,
  };
  dbSearch = new ReconciliationReportS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 10);

  queryStringParameters = {
    limit: 10,
    page: 11,
  };
  dbSearch = new ReconciliationReportS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 0);
});

test.serial('ReconciliationReportS3Search supports prefix search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 50,
    prefix: 'fakeReconReport-1',
  };
  const dbSearch = new ReconciliationReportS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 11);
  t.is(response.results?.length, 11);
});

test.serial('ReconciliationReportS3Search supports infix search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 50,
    infix: 'conReport-2',
  };
  const dbSearch = new ReconciliationReportS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 11);
  t.is(response.results?.length, 11);
});

test.serial('ReconciliationReportS3Search supports sorting', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 100,
    sort_by: 'type',
    order: 'asc',
  };
  const dbSearch = new ReconciliationReportS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
  t.true(response.results[0].type < response.results[15].type);
  t.true(response.results[16].type < response.results[30].type);
  t.true(response.results[31].type < response.results[45].type);
});

test.serial('ReconciliationReportS3Search supports term search for string fields', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 100,
    status: 'Generated',
  };
  const dbSearch = new ReconciliationReportS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 17);
  t.is(response.results?.length, 17);
  t.true(response.results?.every((result) => result.status === 'Generated'));
});

test.serial('ReconciliationReportS3Search supports term search for date fields', async (t) => {
  const { connection } = t.context;
  const testUpdatedAt = t.context.reconReportSearchTimestamp + 1;
  const queryStringParameters = {
    limit: 100,
    updatedAt: `${testUpdatedAt}`,
  };
  const dbSearch = new ReconciliationReportS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
  t.true(response.results?.every((report) => report.updatedAt === testUpdatedAt));
});

test.serial('ReconciliationReportS3Search supports range search', async (t) => {
  const { connection } = t.context;
  const timestamp1 = t.context.reconReportSearchTimestamp - 1;
  const timestamp2 = t.context.reconReportSearchTimestamp + 1;
  const queryStringParameters = {
    limit: 100,
    timestamp__from: `${timestamp1}`,
    timestamp__to: `${timestamp2}`,
  };
  const dbSearch = new ReconciliationReportS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();

  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
  t.true(response.results?.every((report) => report.updatedAt >= timestamp1
    && report.updatedAt <= timestamp2));
});

test.serial('ReconciliationReportS3Search supports search for multiple fields', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 50,
    type: 'Inventory',
    status: 'Failed',
  };

  const dbSearch = new ReconciliationReportS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 4);
  t.is(response.results?.length, 4);
  t.true(response.results?.every((report) =>
    report.type === 'Inventory' && report.status === 'Failed'));
});

test.serial('ReconciliationReportS3Search returns fields specified', async (t) => {
  const { connection } = t.context;
  let fields = 'name';
  let queryStringParameters = {
    fields,
  };
  let dbSearch = new ReconciliationReportS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 10);
  response.results.forEach((report) => t.deepEqual(Object.keys(report), fields.split(',')));

  fields = 'name,type,status';
  queryStringParameters = {
    fields,
  };
  dbSearch = new ReconciliationReportS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 10);
  response.results.forEach((report) => t.deepEqual(Object.keys(report), fields.split(',')));
});

test.serial('ReconciliationReportS3Search ignores non-existing fields', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 100,
    non_existing_field: `non_exist_${cryptoRandomString({ length: 5 })}`,
    non_existing_field__from: `non_exist_${cryptoRandomString({ length: 5 })}`,
  };
  const dbSearch = new ReconciliationReportS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

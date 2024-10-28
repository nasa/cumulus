'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');
const { ReconciliationReportSearch } = require('../../dist/search/ReconciliationReportSearch');

const {
  ReconciliationReportPgModel,
  fakeReconciliationReportRecordFactory,
  generateLocalTestDb,
  destroyLocalTestDb,
  migrationDir,
} = require('../../dist');

const testDbName = `reconReport_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );

  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;
  t.context.reconciliationReportPgModel = new ReconciliationReportPgModel();
  const reconReportTypes = ['Granule Inventory', 'Granule Not Found', 'Inventory', 'ORCA Backup'];
  const reconReportStatuses = ['Generated', 'Pending', 'Failed'];
  const reconReports = [];
  t.context.reconReportSearchTimestamp = 1704100000000;
  t.context.reportBucket = cryptoRandomString({ length: 8 });
  t.context.reportKey = cryptoRandomString({ length: 8 });

  range(50).map((num) => (
    reconReports.push(fakeReconciliationReportRecordFactory({
      name: `fakeReconReport-${num + 1}`,
      type: reconReportTypes[num % 4],
      status: reconReportStatuses[num % 3],
      location: `s3://fakeBucket${t.context.reportBucket}/fakeKey${t.context.reportKey}`,
      updated_at: new Date(t.context.reconReportSearchTimestamp + (num % 2)),
      created_at: new Date(t.context.reconReportSearchTimestamp - (num % 2)),
    }))
  ));

  await t.context.reconciliationReportPgModel.insert(t.context.knex, reconReports);
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('ReconciliationReportSearch returns the correct response for a basic query', async (t) => {
  const { knex } = t.context;
  const dbSearch = new ReconciliationReportSearch({});
  const response = await dbSearch.query(knex);
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

test('ReconciliationReportSearch supports page and limit params', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 25,
    page: 2,
  };
  let dbSearch = new ReconciliationReportSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 10,
    page: 5,
  };
  dbSearch = new ReconciliationReportSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 10);

  queryStringParameters = {
    limit: 10,
    page: 11,
  };
  dbSearch = new ReconciliationReportSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 0);
});

test('ReconciliationReportSearch supports prefix search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 50,
    prefix: 'fakeReconReport-1',
  };
  const dbSearch = new ReconciliationReportSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 11);
  t.is(response.results?.length, 11);
});

test('ReconciliationReportSearch supports infix search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 50,
    infix: 'conReport-2',
  };
  const dbSearch = new ReconciliationReportSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 11);
  t.is(response.results?.length, 11);

  // queryStringParameters = {
  //   limit: 50,
  //   infix: 'ending', // ending, status
  // }
  // dbSearch = new ReconciliationReportSearch({ queryStringParameters });
  // response = await dbSearch.query(knex);
  // t.is(response.meta.count, 17);
  // t.is(response.results?.length, 17);
});

test('ReconciliationReportSearch supports sorting', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 100,
    sort_by: 'type',
    order: 'asc',
  };
  const dbSearch = new ReconciliationReportSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
  t.true(response.results[0].type < response.results[15].type);
  t.true(response.results[16].type < response.results[30].type);
  t.true(response.results[31].type < response.results[45].type);
});

test('ReconciliationReportSearch supports term search for string fields', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 100,
    status: 'Generated',
  };
  const dbSearch = new ReconciliationReportSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 17);
  t.is(response.results?.length, 17);
  t.true(response.results?.every((result) => result.status === 'Generated'));
});

test('ReconciliationReportSearch supports term search for date fields', async (t) => {
  const { knex } = t.context;
  const testUpdatedAt = t.context.reconReportSearchTimestamp + 1;
  const queryStringParameters = {
    limit: 100,
    updatedAt: `${testUpdatedAt}`,
  };
  const dbSearch = new ReconciliationReportSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
  t.true(response.results?.every((report) => report.updatedAt === testUpdatedAt));
});

test('ReconciliationReportSearch supports range search', async (t) => {
  const { knex } = t.context;
  const timestamp1 = t.context.reconReportSearchTimestamp - 1;
  const timestamp2 = t.context.reconReportSearchTimestamp + 1;
  const queryStringParameters = {
    limit: 100,
    timestamp__from: `${timestamp1}`,
    timestamp__to: `${timestamp2}`,
  };
  const dbSearch = new ReconciliationReportSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);

  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
  t.true(response.results?.every((report) => report.updatedAt >= timestamp1
    && report.updatedAt <= timestamp2));
});

test('ReconciliationReportSearch supports search for multiple fields', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 50,
    type: 'Inventory',
    status: 'Failed',
  };

  const dbSearch = new ReconciliationReportSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 4);
  t.is(response.results?.length, 4);
  t.true(response.results?.every((report) =>
    report.type === 'Inventory' && report.status === 'Failed'));
});

test('ReconciliationReportSearch returns fields specified', async (t) => {
  const { knex } = t.context;
  let fields = 'name';
  let queryStringParameters = {
    fields,
  };
  let dbSearch = new ReconciliationReportSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 10);
  response.results.forEach((report) => t.deepEqual(Object.keys(report), fields.split(',')));

  fields = 'name,type,status';
  queryStringParameters = {
    fields,
  };
  dbSearch = new ReconciliationReportSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 10);
  response.results.forEach((report) => t.deepEqual(Object.keys(report), fields.split(',')));
});

test('ReconciliationReportSearch ignores non-existing fields', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 100,
    non_existing_field: `non_exist_${cryptoRandomString({ length: 5 })}`,
    non_existing_field__from: `non_exist_${cryptoRandomString({ length: 5 })}`,
  };
  const dbSearch = new ReconciliationReportSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

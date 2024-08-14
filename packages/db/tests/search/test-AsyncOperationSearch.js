'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');
const range = require('lodash/range');
const { AsyncOperationSearch } = require('../../dist/search/AsyncOperationSearch');

const {
  destroyLocalTestDb,
  generateLocalTestDb,
  fakeAsyncOperationRecordFactory,
  migrationDir,
  AsyncOperationPgModel,
} = require('../../dist');

const testDbName = `asyncOperation_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );

  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.asyncOperationPgModel = new AsyncOperationPgModel();
  t.context.asyncOperations = [];
  t.context.asyncOperationSearchTmestamp = 1579352700000;

  range(100).map((num) => (
    t.context.asyncOperations.push(fakeAsyncOperationRecordFactory({
      cumulus_id: num,
      updated_at: new Date(t.context.asyncOperationSearchTmestamp + (num % 2)),
      operation_type: num % 2 === 0 ? 'Bulk Granules' : 'Data Migration',
    }))
  ));

  //const statuses = ['RUNNING', 'SUCCEEDED', 'RUNNER_FAILED', 'TASK_FAILED'];
  await t.context.asyncOperationPgModel.insert(
    t.context.knex,
    t.context.asyncOperations
  );
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('AsyncOperationSearch returns 10 async operations by default', async (t) => {
  const { knex } = t.context;
  const dbSearch = new AsyncOperationSearch({});
  const results = await dbSearch.query(knex);
  t.is(results.meta.count, 100);
  t.is(results.results.length, 10);
});

test('AsyncOperationSearch supports page and limit params', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 20,
    page: 2,
  };
  let dbSearch = new AsyncOperationSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 20);

  queryStringParameters = {
    limit: 11,
    page: 10,
  };
  dbSearch = new AsyncOperationSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 1);

  queryStringParameters = {
    limit: 10,
    page: 11,
  };
  dbSearch = new AsyncOperationSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 0);
});

test('AsyncOperationSearch supports infix search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 20,
    infix: t.context.asyncOperations[5].id.slice(1),
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('AsyncOperationSearch supports prefix search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 20,
    prefix: t.context.asyncOperations[5].id.slice(0, -1),
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('AsyncOperationSearch supports term search for uuid field and returns the correct record', async (t) => {
  const { knex } = t.context;
  const dbRecord = t.context.asyncOperations[5];
  const queryStringParameters = {
    limit: 200,
    id: dbRecord.id,
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);

  const expectedApiRecord = {
    id: dbRecord.id,
    description: dbRecord.description,
    operationType: dbRecord.operation_type,
    status: dbRecord.status,
    output: JSON.stringify(dbRecord.output),
    taskArn: dbRecord.task_arn,
    updatedAt: new Date(dbRecord.updated_at).getTime(),
  };
  t.deepEqual(omit(response.results?.[0], 'createdAt'), expectedApiRecord);
  t.truthy(response.results?.[0]?.createdAt);
});

test('AsyncOperationSearch supports term search for date field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    updatedAt: `${t.context.asyncOperationSearchTmestamp + 1}`,
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('AsyncOperationSearch supports term search for _id field', async (t) => {
  const { knex } = t.context;
  const dbRecord = t.context.asyncOperations[5];
  const queryStringParameters = {
    limit: 200,
    _id: dbRecord.id,
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('AsyncOperationSearch supports term search for string field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    operationType: 'Bulk Granules',
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('AsyncOperationSearch supports range search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    timestamp__from: `${t.context.asyncOperationSearchTmestamp + 1}`,
    timestamp__to: `${t.context.asyncOperationSearchTmestamp + 2}`,
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.only('AsyncOperationSearch supports search for multiple fields', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    id: t.context.asyncOperations[2].id,
    updatedAt: `${t.context.asyncOperationSearchTmestamp}`,
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('AsyncOperationSearch non-existing fields are ignored', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    non_existing_field: `non_exist_${cryptoRandomString({ length: 5 })}`,
    non_existing_field__from: `non_exist_${cryptoRandomString({ length: 5 })}`,
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);
});

test('AsyncOperationSearch returns fields specified', async (t) => {
  const { knex } = t.context;
  const fields = 'name,version,reportToEms,process';
  const queryStringParameters = {
    fields,
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 10);
  response.results.forEach((collection) => t.deepEqual(Object.keys(collection), fields.split(',')));
});

test('AsyncOperationSearch supports sorting', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    sort_by: 'name',
    order: 'asc',
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);
  t.true(response.results[0].name < response.results[99].name);
  t.true(response.results[0].name < response.results[50].name);

  queryStringParameters = {
    limit: 200,
    sort_key: ['-name'],
  };
  const dbSearch2 = new AsyncOperationSearch({ queryStringParameters });
  const response2 = await dbSearch2.query(knex);
  t.is(response2.meta.count, 100);
  t.is(response2.results?.length, 100);
  t.true(response2.results[0].name > response2.results[99].name);
  t.true(response2.results[0].name > response2.results[50].name);

  queryStringParameters = {
    limit: 200,
    sort_by: 'version',
  };
  const dbSearch3 = new AsyncOperationSearch({ queryStringParameters });
  const response3 = await dbSearch3.query(knex);
  t.is(response3.meta.count, 100);
  t.is(response3.results?.length, 100);
  t.true(response3.results[0].version < response3.results[99].version);
  t.true(response3.results[49].version < response3.results[50].version);
});

test('AsyncOperationSearch supports terms search', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    process__in: ['ingest', 'archive'].join(','),
  };
  let dbSearch = new AsyncOperationSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    process__in: ['ingest', 'archive'].join(','),
    _id__in: ['testCollection___0', 'fakeCollection___1'].join(','),
  };
  dbSearch = new AsyncOperationSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('AsyncOperationSearch supports search when collection field does not match the given value', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    process__not: 'publish',
  };
  let dbSearch = new AsyncOperationSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    process__not: 'publish',
    version__not: 18,
  };
  dbSearch = new AsyncOperationSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 49);
  t.is(response.results?.length, 49);
});

test('AsyncOperationSearch supports search which checks existence of collection field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    url_path__exists: 'true',
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

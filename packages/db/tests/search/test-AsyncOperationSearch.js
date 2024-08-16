'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const { v4: uuidv4 } = require('uuid');
const omit = require('lodash/omit');
const range = require('lodash/range');
const { AsyncOperationSearch } = require('../../dist/search/AsyncOperationSearch');
const {
  translatePostgresAsyncOperationToApiAsyncOperation,
} = require('../../dist/translate/async_operations');

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
      task_arn: num % 2 === 0 ? cryptoRandomString({ length: 3 }) : undefined,
    }))
  ));

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
  const { results, meta } = await dbSearch.query(knex);
  t.is(meta.count, 100);
  t.is(results.length, 10);
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
  const { results, meta } = await dbSearch.query(knex);
  t.is(meta.count, 1);
  t.is(results?.length, 1);
});

test('AsyncOperationSearch supports prefix search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 20,
    prefix: t.context.asyncOperations[5].id.slice(0, -1),
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const { results, meta } = await dbSearch.query(knex);
  t.is(meta.count, 1);
  t.is(results?.length, 1);
});

test('AsyncOperationSearch supports term search for uuid field', async (t) => {
  const { knex } = t.context;
  const dbRecord = t.context.asyncOperations[5];
  const queryStringParameters = {
    limit: 200,
    id: dbRecord.id,
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const { results, meta } = await dbSearch.query(knex);
  t.is(meta.count, 1);
  t.is(results?.length, 1);
});

test('AsyncOperationSearch supports term search for date field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    updatedAt: `${t.context.asyncOperationSearchTmestamp + 1}`,
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const { results, meta } = await dbSearch.query(knex);
  t.is(meta.count, 50);
  t.is(results?.length, 50);
});

test('AsyncOperationSearch supports term search for _id field', async (t) => {
  const { knex } = t.context;
  const dbRecord = t.context.asyncOperations[5];
  const queryStringParameters = {
    limit: 200,
    _id: dbRecord.id,
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const { results, meta } = await dbSearch.query(knex);
  t.is(meta.count, 1);
  t.is(results?.length, 1);
});

test('AsyncOperationSearch supports term search for string field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    operationType: 'Bulk Granules',
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const { results, meta } = await dbSearch.query(knex);
  t.is(meta.count, 50);
  t.is(results?.length, 50);
});

test('AsyncOperationSearch supports range search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    timestamp__from: `${t.context.asyncOperationSearchTmestamp + 1}`,
    timestamp__to: `${t.context.asyncOperationSearchTmestamp + 2}`,
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const { results, meta } = await dbSearch.query(knex);
  t.is(meta.count, 50);
  t.is(results?.length, 50);
});

test('AsyncOperationSearch supports search for multiple fields', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    id: t.context.asyncOperations[2].id,
    updatedAt: `${t.context.asyncOperationSearchTmestamp}`,
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const { results, meta } = await dbSearch.query(knex);
  t.is(meta.count, 1);
  t.is(results?.length, 1);
});

test('AsyncOperationSearch non-existing fields are ignored', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    non_existing_field: `non_exist_${cryptoRandomString({ length: 5 })}`,
    non_existing_field__from: `non_exist_${cryptoRandomString({ length: 5 })}`,
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const { results, meta } = await dbSearch.query(knex);
  t.is(meta.count, 100);
  t.is(results?.length, 100);
});

test('AsyncOperationSearch returns fields specified', async (t) => {
  const { knex } = t.context;
  const fields = 'id,operationType,status,taskArn';
  const queryStringParameters = {
    fields,
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const { results, meta } = await dbSearch.query(knex);
  t.is(meta.count, 100);
  t.is(results?.length, 10);
  results.forEach((asyncOperation) => t.deepEqual(Object.keys(asyncOperation), fields.split(',')));
});

test('AsyncOperationSearch supports sorting', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    sort_by: 'id',
    order: 'asc',
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);
  t.true(response.results[0].id < response.results[99].id);
  t.true(response.results[0].id < response.results[50].id);

  queryStringParameters = {
    limit: 200,
    sort_key: ['-id'],
  };
  const dbSearch2 = new AsyncOperationSearch({ queryStringParameters });
  const response2 = await dbSearch2.query(knex);
  t.is(response2.meta.count, 100);
  t.is(response2.results?.length, 100);
  t.true(response2.results[0].id > response2.results[99].id);
  t.true(response2.results[0].id > response2.results[50].id);

  queryStringParameters = {
    limit: 200,
    sort_by: 'operationType',
  };
  const dbSearch3 = new AsyncOperationSearch({ queryStringParameters });
  const response3 = await dbSearch3.query(knex);
  t.is(response3.meta.count, 100);
  t.is(response3.results?.length, 100);
  t.true(response3.results[0].operationType < response3.results[99].operationType);
  t.true(response3.results[49].operationType < response3.results[50].operationType);
});

test('AsyncOperationSearch supports terms search', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    operationType__in: ['Bulk Granules', 'NOTEXIST'].join(','),
  };
  let dbSearch = new AsyncOperationSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    operationType__in: ['Bulk Granules', 'NOTEXIST'].join(','),
    _id__in: [t.context.asyncOperations[2].id, uuidv4()].join(','),
  };
  dbSearch = new AsyncOperationSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('AsyncOperationSearch supports search when asyncOperation field does not match the given value', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    operationType__not: 'Bulk Granules',
  };
  let dbSearch = new AsyncOperationSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    operationType__not: 'Bulk Granules',
    id__not: t.context.asyncOperations[1].id,
  };
  dbSearch = new AsyncOperationSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 49);
  t.is(response.results?.length, 49);
});

test('AsyncOperationSearch supports search which checks existence of asyncOperation field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    taskArn__exists: 'false',
    output_exists: 'true',
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const { results, meta } = await dbSearch.query(knex);
  t.is(meta.count, 50);
  t.is(results?.length, 50);
});

test('AsyncOperationSearch returns the correct record', async (t) => {
  const { knex } = t.context;
  const dbRecord = t.context.asyncOperations[2];
  const queryStringParameters = {
    limit: 200,
    id: dbRecord.id,
  };
  const dbSearch = new AsyncOperationSearch({ queryStringParameters });
  const { results, meta } = await dbSearch.query(knex);
  t.is(meta.count, 1);
  t.is(results?.length, 1);

  const expectedApiRecord = translatePostgresAsyncOperationToApiAsyncOperation(dbRecord);
  t.deepEqual(omit(results?.[0], 'createdAt'), omit(expectedApiRecord, 'createdAt'));
  t.truthy(results?.[0]?.createdAt);
});

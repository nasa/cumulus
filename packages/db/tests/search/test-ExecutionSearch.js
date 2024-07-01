'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { ExecutionSearch } = require('../../dist/search/ExecutionSearch');

const {
  generateLocalTestDb,
  destroyLocalTestDb,
  CollectionPgModel,
  fakeAsyncOperationRecordFactory,
  fakeCollectionRecordFactory,
  migrationDir,
  fakeExecutionRecordFactory,
  ExecutionPgModel,
  AsyncOperationPgModel,
} = require('../../dist');

const testDbName = `collection_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );

  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  const statuses = ['queued', 'failed', 'completed', 'running'];
  const errors = [{ Error: 'UnknownError' }, { Error: 'CumulusMessageAdapterError' }, { Error: 'IngestFailure' }, { Error: 'CmrFailure' }, {}];

  // Create a PG Collection
  t.context.collectionPgModel = new CollectionPgModel();
  t.context.testPgCollection = fakeCollectionRecordFactory(
    { cumulus_id: 0,
      name: 'testCollection',
      version: 8 }
  );
  t.context.testPgCollection2 = fakeCollectionRecordFactory(
    { cumulus_id: 1,
      name: 'fakeCollection',
      version: 2 }
  );
  await t.context.collectionPgModel.insert(
    t.context.knex,
    [t.context.testPgCollection, t.context.testPgCollection2]
  );

  t.context.CumulusId1 = t.context.testPgCollection.cumulus_id;
  t.context.CumulusId2 = t.context.testPgCollection2.cumulus_id;

  t.context.collectionId1 = constructCollectionId(
    t.context.testPgCollection.name,
    t.context.testPgCollection.version
  );

  t.context.asyncOperationsPgModel = new AsyncOperationPgModel();
  t.context.testAsyncOperation = fakeAsyncOperationRecordFactory({ cumulus_id: 140 });
  t.context.testAsyncOperation2 = fakeAsyncOperationRecordFactory({ cumulus_id: 150 });

  t.context.asyncCumulusId1 = t.context.testAsyncOperation.cumulus_id;
  t.context.asyncCumulusId2 = t.context.testAsyncOperation2.cumulus_id;

  await t.context.asyncOperationsPgModel.insert(
    t.context.knex,
    [t.context.testAsyncOperation, t.context.testAsyncOperation2]
  );

  t.context.duration = 100;

  const executions = [];
  t.context.executionPgModel = new ExecutionPgModel();

  t.context.testTimeStamp1 = '1633406400000';
  t.context.testTimeStamp2 = '1550725200000';
  t.context.testTimeStamp3 = '1800725210000';
  range(50).map((num) => (
    executions.push(fakeExecutionRecordFactory({
      collection_cumulus_id: num % 2 === 0 ? t.context.CumulusId1 : t.context.CumulusId2,
      status: statuses[(num % 3) + 1],
      error: errors[num % 5],
      created_at: (new Date(2018 + (num % 6), (num % 12), (num % 30))).toISOString(),
      updated_at: (new Date(2018 + (num % 6), (num % 12), ((num + 1) % 29))).toISOString(),
      workflow_name: `testWorkflow__${num}`,
      arn: num % 2 === 0 ? `testArn__${num}:testExecutionName` : `fakeArn__${num}:fakeExecutionName`,
      url: `https://fake-execution${num}.com/`,
      original_payload: {
        orginal: `payload__${num}`,
      },
      final_payload: num % 2 === 0 ? {
        final: `payload__${num}`,
      } : undefined,
      duration: num > 0 ? t.context.duration * ((num % 2) + 1) : undefined,
      async_operation_cumulus_id: num % 2 === 0 ? t.context.testAsyncOperation.cumulus_id
        : t.context.testAsyncOperation2.cumulus_id,
      parent_cumulus_id: num > 25 ? num % 25 : null,
      cumulus_id: num,
    }))
  ));

  await t.context.executionPgModel.insert(
    t.context.knex,
    executions
  );
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('ExecutionSearch returns correct response for basic query', async (t) => {
  const { knex } = t.context;
  const dbSearch = new ExecutionSearch({});
  const results = await dbSearch.query(knex);
  t.is(results.meta.count, 50);
  t.is(results.results.length, 10);
});

test('ExecutionSearch supports page and limit params', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 25,
    page: 2,
  };
  let dbSearch = new ExecutionSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 10,
    page: 5,
  };
  dbSearch = new ExecutionSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 10);

  queryStringParameters = {
    limit: 10,
    page: 11,
  };
  dbSearch = new ExecutionSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 0);
});

test('ExecutionSearch supports infix search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 50,
    infix: 'fake',
  };
  const dbSearch = new ExecutionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test('ExecutionSearch supports prefix search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 50,
    prefix: 'test',
  };
  const dbSearch = new ExecutionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test('ExecutionSearch supports collectionId term search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 50,
    collectionId: t.context.collectionId1,
  };
  const dbSearch = new ExecutionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test('ExecutionSearch supports asyncOperationId term search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 50,
    asyncOperationId: t.context.testAsyncOperation.id,
  };
  const dbSearch = new ExecutionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test('ExecutionSearch supports term search for number field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 50,
    duration: 100,
  };
  const dbSearch = new ExecutionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 24);
  t.is(response.results?.length, 24);
});

test('ExecutionSearch supports term search for string field', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 50,
    status: 'completed',
  };
  let dbSearch = new ExecutionSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 17);
  t.is(response.results?.length, 17);

  queryStringParameters = {
    limit: 50,
    type: 'testWorkflow__5',
  };
  dbSearch = new ExecutionSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('ExecutionSearch supports term search for nested error.Error', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    'error.Error': 'CumulusMessageAdapterError',
  };
  const dbSearch = new ExecutionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 10);
  t.is(response.results?.length, 10);
});

test('ExecutionSearch supports range search', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 50,
    duration__from: 100,
    duration__to: 150,
  };
  let dbSearch = new ExecutionSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 24);
  t.is(response.results?.length, 24);

  queryStringParameters = {
    limit: 200,
    timestamp__from: `${t.context.testTimeStamp2}`,
    timestamp__to: `${t.context.testTimeStamp3}`,
  };
  dbSearch = new ExecutionSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 38);
  t.is(response.results?.length, 38);

  queryStringParameters = {
    limit: 200,
    duration__from: 150,
  };
  dbSearch = new ExecutionSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test('ExecutionSearch non-existing fields are ignored', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    non_existing_field: `non_exist_${cryptoRandomString({ length: 5 })}`,
    non_existing_field__from: `non_exist_${cryptoRandomString({ length: 5 })}`,
  };
  const dbSearch = new ExecutionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('ExecutionSearch supports search for multiple fields', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    id: 13,
    workflow_name: 'testWorkflow__13',
    arn: 'fakeArn__13:fakeExecutionName',
    url: 'https://fake-execution13.com/',
  };
  const dbSearch = new ExecutionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('ExecutionSearch supports sorting', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 50,
    sort_by: 'timestamp',
  };
  const dbSearch = new ExecutionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
  t.true(response.results[0].updatedAt < response.results[49].updatedAt);
  t.true(response.results[1].updatedAt < response.results[25].updatedAt);

  queryStringParameters = {
    limit: 50,
    sort_by: 'timestamp',
    order: 'desc',
  };
  const dbSearch2 = new ExecutionSearch({ queryStringParameters });
  const response2 = await dbSearch2.query(knex);
  t.is(response2.meta.count, 50);
  t.is(response2.results?.length, 50);
  t.true(response2.results[0].updatedAt > response2.results[49].updatedAt);
  t.true(response2.results[1].updatedAt > response2.results[25].updatedAt);

  queryStringParameters = {
    limit: 200,
    sort_key: ['-timestamp'],
  };
  const dbSearch3 = new ExecutionSearch({ queryStringParameters });
  const response3 = await dbSearch3.query(knex);
  t.is(response3.meta.count, 50);
  t.is(response3.results?.length, 50);
  t.true(response3.results[0].updatedAt > response3.results[49].updatedAt);
  t.true(response3.results[1].updatedAt > response3.results[25].updatedAt);
});

test('ExecutionSearch supports sorting by Error', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 50,
    sort_by: 'error.Error',
  };
  const dbSearch7 = new ExecutionSearch({ queryStringParameters });
  const response7 = await dbSearch7.query(knex);
  t.is(response7.results[0].error.Error, 'CmrFailure');
  t.is(response7.results[49].error.Error, undefined);

  queryStringParameters = {
    limit: 50,
    sort_by: 'error.Error.keyword',
    order: 'desc',
  };
  const dbSearch10 = new ExecutionSearch({ queryStringParameters });
  const response10 = await dbSearch10.query(knex);
  t.is(response10.results[0].error.Error, undefined);
  t.is(response10.results[49].error.Error, 'CmrFailure');
});

test('ExecutionSearch supports terms search', async (t) => {
  const { knex } = t.context;

  let queryStringParameters = {
    limit: 50,
    type__in: ['testWorkflow__1', 'testWorkflow__2'].join(','),
  };
  let dbSearch = new ExecutionSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 2);
  t.is(response.results?.length, 2);

  queryStringParameters = {
    limit: 50,
    type__in: ['testWorkflow__1', 'testWorkflow__2'].join(','),
    status__in: 'running',
  };
  dbSearch = new ExecutionSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('ExecutionSearch supports error.Error terms search', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 50,
    'error.Error__in': ['CumulusMessageAdapterError', 'UnknownError'].join(','),
  };
  let dbSearch = new ExecutionSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 20);
  t.is(response.results?.length, 20);

  queryStringParameters = {
    limit: 50,
    'error.Error__in': 'unknownerror',
  };
  dbSearch = new ExecutionSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);
});

test('ExecutionSearch supports search which checks existence of execution field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 50,
    duration__exists: 'true',
  };
  const dbSearch = new ExecutionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 49);
  t.is(response.results?.length, 49);
});

test('ExecutionSearch supports search which execution field does not match the given value', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 50,
    status__not: 'completed',
  };
  const dbSearch = new ExecutionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 33);
  t.is(response.results?.length, 33);
});

test('ExecutionSearch supports term search for timestamp', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 50,
    timestamp: `${t.context.testTimeStamp2}`,
  };
  const dbSearch = new ExecutionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('ExecutionSearch supports term search for date field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 50,
    updatedAt: `${t.context.testTimeStamp1}`,
  };
  const dbSearch = new ExecutionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

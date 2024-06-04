'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');
const { ExecutionSearch } = require('../../dist/search/ExecutionSearch');

const {
  generateLocalTestDb,
  destroyLocalTestDb,
  CollectionPgModel,
  fakeCollectionRecordFactory,
  migrationDir,
  fakeExecutionRecordFactory,
  ExecutionPgModel,
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
  // const collections = [];

  // Create a PG Collection
  t.context.testPgCollection = fakeCollectionRecordFactory();
  const collectionPgModel = new CollectionPgModel();
  const [pgCollection] = await collectionPgModel.create(
    t.context.knex,
    t.context.testPgCollection
  );
  t.context.collectionCumulusId = pgCollection.cumulus_id;
  t.context.duration = 100;

  const executions = [];
  t.context.executionPgModel = new ExecutionPgModel();
  range(50).map((num) => (
    executions.push(fakeExecutionRecordFactory({
      //collection_cumulus_id: t.context.collectionCumulusId, -- need to look at this, causing errors
      status: statuses[(num % 3) + 1],
      error: errors[num % 5],
      created_at: (new Date(2018 + (num % 6), (num % 12), (num % 30))).toISOString(),
      updated_at: (new Date(2018 + (num % 6), (num % 12), ((num + 1) % 29))).toISOString(),
      cumulus_id: num,
      workflow_name: `testWorkflow__${num}`,
      arn: num % 2 === 0 ? `testArn__${num}` : `fakeArn__${num}`,
      url: `https://fake-execution${num}.com/`,
      original_payload: {
        orginal: `payload__${num}`,
      },
      final_payload: {
        final: `payload__${num}`,
      },
      duration: t.context.duration * ((num % 2) + 1),
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
  const dbSearch = new ExecutionSearch();
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

test.todo('ExecutionSearch supports collectionId term search');

test('ExecutionSearch supports term search for date field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 50,
    updatedAt: 1633406400000,
  };
  const dbSearch = new ExecutionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('GranuleSearch supports term search for number field', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 50,
    duration: 100,
  };
  let dbSearch = new ExecutionSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 50,
    id: 1,
  };
  dbSearch = new ExecutionSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
  t.is(response.results[0]?.name, 'fakeArn__1');
});

test('GranuleSearch supports term search for string field', async (t) => {
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
    workflowName: 'testWorkflow__5',
  };
  dbSearch = new ExecutionSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('GranuleSearch supports term search for timestamp', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 50,
    timestamp: 1550725200000,
  };
  const dbSearch = new ExecutionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('GranuleSearch supports term search for nested error.Error', async (t) => {
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

test('GranuleSearch supports range search', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 50,
    duration__from: 100,
    duration__to: 150,
  };
  let dbSearch = new ExecutionSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    limit: 200,
    timestamp__from: 1550725200000,
    timestamp__to: 1800725210000,
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

test('GranuleSearch non-existing fields are ignored', async (t) => {
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

test('GranuleSearch supports search for multiple fields', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    id: 10,
    workflow_name: 'testWorkflow__10',
    arn: 'testArn__10',
    url: 'https://fake-execution10.com/',
  };
  const dbSearch = new ExecutionSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('GranuleSearch supports sorting', async (t) => {
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

test('GranuleSearch supports sorting by Error', async (t) => {
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

/*
test('GranuleSearch supports terms search', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    granuleId__in: [t.context.granuleIds[0], t.context.granuleIds[5]].join(','),
    published__in: 'true,false',
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 2);
  t.is(response.results?.length, 2);

  queryStringParameters = {
    limit: 200,
    granuleId__in: [t.context.granuleIds[0], t.context.granuleIds[5]].join(','),
    published__in: 'true',
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('GranuleSearch supports collectionId terms search', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    collectionId__in: [t.context.collectionId2, constructCollectionId('fakecollectionterms', 'v1')].join(','),
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    collectionId__in: [t.context.collectionId, t.context.collectionId2].join(','),
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);
});

test('GranuleSearch supports error.Error terms search', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    'error.Error__in': [t.context.granuleSearchFields['error.Error'], 'unknownerror'].join(','),
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    'error.Error__in': 'unknownerror',
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);
});

test('GranuleSearch supports search which checks existence of granule field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    cmrLink__exists: 'true',
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('GranuleSearch supports search which granule field does not match the given value', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    granuleId__not: t.context.granuleIds[0],
    published__not: 'true',
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 49);
  t.is(response.results?.length, 49);
*/
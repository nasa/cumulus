'use strict';

const test = require('ava');
const knex = require('knex');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');
const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { constructCollectionId } = require('@cumulus/message/Collections');
const {
  createDuckDBTables,
  setupDuckDBWithS3ForTesting,
  stageAndLoadDuckDBTableFromData,
} = require('../../dist/test-duckdb-utils');
const {
  asyncOperationsS3TableSql,
  collectionsS3TableSql,
  executionsS3TableSql,
} = require('../../dist/s3search/s3TableSchemas');
const { ExecutionS3Search } = require('../../dist/s3search/ExecutionS3Search');
const {
  fakeAsyncOperationRecordFactory,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
} = require('../../dist');

test.before(async (t) => {
  t.context.knexBuilder = knex({ client: 'pg' });

  const statuses = ['queued', 'failed', 'completed', 'running'];
  const errors = [{ Error: 'UnknownError' }, { Error: 'CumulusMessageAdapterError' }, { Error: 'IngestFailure' }, { Error: 'CmrFailure' }, {}];

  // Create a PG Collection
  t.context.testPgCollection = fakeCollectionRecordFactory(
    { cumulus_id: 0,
      name: 'testCollection',
      version: 8 }
  );

  t.context.collectionCumulusId = t.context.testPgCollection.cumulus_id;

  t.context.collectionId = constructCollectionId(
    t.context.testPgCollection.name,
    t.context.testPgCollection.version
  );

  t.context.testAsyncOperation = fakeAsyncOperationRecordFactory({ cumulus_id: 140 });
  t.context.asyncCumulusId = t.context.testAsyncOperation.cumulus_id;

  t.context.duration = 100;

  const executions = range(50).map((num) => (
    fakeExecutionRecordFactory({
      collection_cumulus_id: num % 2 === 0 ? t.context.collectionCumulusId : undefined,
      status: statuses[(num % 3) + 1],
      error: errors[num % 5],
      created_at: (new Date(2018 + (num % 6), (num % 12), (num % 30))),
      updated_at: (new Date(2018 + (num % 6), (num % 12), ((num + 1) % 29))),
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
      async_operation_cumulus_id: num % 2 === 0 ? t.context.asyncCumulusId
        : undefined,
      parent_cumulus_id: num > 25 ? num % 25 : undefined,
      cumulus_id: num,
      timestamp: (new Date(2018 + (num % 6), (num % 12), ((num + 1) % 29))),
      archived: Boolean(num % 2),
    })
  ));

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
    t.context.testPgCollection,
    `${duckdbS3Prefix}collections.parquet`
  );

  console.log('create asyncOperation');
  await stageAndLoadDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'async_operations',
    asyncOperationsS3TableSql,
    t.context.testAsyncOperation,
    `${duckdbS3Prefix}async_operations.parquet`
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
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.testBucket);
  await t.context.connection.closeSync();
});

test.serial('ExecutionS3Search returns correct response for basic query', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    estimateTableRowCount: 'false',
  };
  const dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  const results = await dbSearch.query();
  t.is(results.meta.count, 50);
  t.is(results.results.length, 10);
  const expectedResponse1 = {
    name: 'testExecutionName',
    status: 'failed',
    arn: 'testArn__0:testExecutionName',
    error: { Error: 'UnknownError' },
    originalPayload: { orginal: 'payload__0' },
    finalPayload: { final: 'payload__0' },
    type: 'testWorkflow__0',
    execution: 'https://fake-execution0.com/',
    collectionId: 'testCollection___8',
    createdAt: new Date(2017, 11, 31).getTime(),
    updatedAt: new Date(2018, 0, 1).getTime(),
    timestamp: new Date(2018, 0, 1).getTime(),
    archived: false,
  };

  const expectedResponse10 = {
    name: 'fakeExecutionName',
    status: 'failed',
    arn: 'fakeArn__9:fakeExecutionName',
    duration: 200,
    error: {},
    originalPayload: { orginal: 'payload__9' },
    type: 'testWorkflow__9',
    execution: 'https://fake-execution9.com/',
    createdAt: new Date(2021, 9, 9).getTime(),
    updatedAt: new Date(2021, 9, 10).getTime(),
    timestamp: new Date(2021, 9, 10).getTime(),
    archived: true,
  };
  t.deepEqual(results.results[0], expectedResponse1);
  t.deepEqual(results.results[9], expectedResponse10);
});

test.serial('ExecutionS3Search supports page and limit params', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 25,
    page: 2,
  };
  let dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 25);

  queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 10,
    page: 5,
  };
  dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 10);

  queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 10,
    page: 11,
  };
  dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 0);
});

test.serial('ExecutionS3Search supports infix search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 50,
    infix: 'fake',
  };
  const dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test.serial('ExecutionS3Search supports prefix search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 50,
    prefix: 'test',
  };
  const dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test.serial('ExecutionS3Search supports collectionId term search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 50,
    collectionId: t.context.collectionId,
  };
  const dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test.serial('ExecutionS3Search supports asyncOperationId term search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 50,
    asyncOperationId: t.context.testAsyncOperation.id,
  };
  const dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
  t.is(response.results[0].asyncOperationId, t.context.testAsyncOperation.id);
});

test.serial('ExecutionS3Search supports term search for number field', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 50,
    duration: 100,
  };
  const dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 24);
  t.is(response.results?.length, 24);
});

test.serial('ExecutionS3Search supports term search for string field', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 50,
    status: 'completed',
  };
  let dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 17);
  t.is(response.results?.length, 17);

  queryStringParameters = {
    limit: 50,
    type: 'testWorkflow__5',
  };
  dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test.serial('ExecutionS3Search supports term search for nested error.Error', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    'error.Error': 'CumulusMessageAdapterError',
  };
  const dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 10);
  t.is(response.results?.length, 10);
});

test.serial('ExecutionS3Search supports range search', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 50,
    duration__from: 100,
    duration__to: 150,
  };
  let dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 24);
  t.is(response.results?.length, 24);

  queryStringParameters = {
    limit: 200,
    duration__from: 150,
  };
  dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 25);
  t.is(response.results?.length, 25);
});

test.serial('ExecutionS3Search non-existing fields are ignored', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 200,
    non_existing_field: `non_exist_${cryptoRandomString({ length: 5 })}`,
    non_existing_field__from: `non_exist_${cryptoRandomString({ length: 5 })}`,
  };
  const dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test.serial('ExecutionS3Search returns fields specified', async (t) => {
  const { connection } = t.context;
  const fields = 'status,arn,type,error';
  const queryStringParameters = {
    estimateTableRowCount: 'false',
    fields,
  };
  const dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 10);
  response.results.forEach((execution) => t.deepEqual(Object.keys(execution), fields.split(',')));
});

test.serial('ExecutionS3Search supports search for multiple fields', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    id: 13,
    workflow_name: 'testWorkflow__13',
    arn: 'fakeArn__13:fakeExecutionName',
    url: 'https://fake-execution13.com/',
  };
  const dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test.serial('ExecutionS3Search supports sorting', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 50,
    sort_by: 'timestamp',
  };
  const dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
  t.true(response.results[0].updatedAt < response.results[49].updatedAt);
  t.true(response.results[1].updatedAt < response.results[25].updatedAt);

  queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 50,
    sort_by: 'timestamp',
    order: 'desc',
  };
  const dbSearch2 = new ExecutionS3Search({ queryStringParameters }, connection);
  const response2 = await dbSearch2.query();
  t.is(response2.meta.count, 50);
  t.is(response2.results?.length, 50);
  t.true(response2.results[0].updatedAt > response2.results[49].updatedAt);
  t.true(response2.results[1].updatedAt > response2.results[25].updatedAt);

  queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 200,
    sort_key: ['-timestamp'],
  };
  const dbSearch3 = new ExecutionS3Search({ queryStringParameters }, connection);
  const response3 = await dbSearch3.query();
  t.is(response3.meta.count, 50);
  t.is(response3.results?.length, 50);
  t.true(response3.results[0].updatedAt > response3.results[49].updatedAt);
  t.true(response3.results[1].updatedAt > response3.results[25].updatedAt);
});

test.serial('ExecutionS3Search supports sorting by Error', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 50,
    sort_by: 'error.Error',
  };
  const dbSearch7 = new ExecutionS3Search({ queryStringParameters }, connection);
  const response7 = await dbSearch7.query();
  t.is(response7.results[0].error.Error, 'CmrFailure');
  t.is(response7.results[49].error.Error, undefined);

  queryStringParameters = {
    limit: 50,
    sort_by: 'error.Error.keyword',
    order: 'desc',
  };
  const dbSearch10 = new ExecutionS3Search({ queryStringParameters }, connection);
  const response10 = await dbSearch10.query();

  // Unlike PostgreSQL sorting, the {} error appears last
  t.is(response10.results[0].error.Error, 'UnknownError');
  t.is(response10.results[49].error.Error, undefined);
});

test.serial('ExecutionS3Search supports terms search', async (t) => {
  const { connection } = t.context;

  let queryStringParameters = {
    limit: 50,
    type__in: ['testWorkflow__1', 'testWorkflow__2'].join(','),
  };
  let dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 2);
  t.is(response.results?.length, 2);

  queryStringParameters = {
    limit: 50,
    type__in: ['testWorkflow__1', 'testWorkflow__2'].join(','),
    status__in: 'running',
  };
  dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test.serial('ExecutionS3Search supports parentArn term search', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    parentArn: 'fakeArn__21:fakeExecutionName',
  };
  let dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  const expectedResponse = {
    name: 'testExecutionName',
    status: 'completed',
    arn: 'testArn__46:testExecutionName',
    duration: 100,
    error: { Error: 'CumulusMessageAdapterError' },
    originalPayload: { orginal: 'payload__46' },
    finalPayload: { final: 'payload__46' },
    type: 'testWorkflow__46',
    execution: 'https://fake-execution46.com/',
    collectionId: 'testCollection___8',
    parentArn: 'fakeArn__21:fakeExecutionName',
    createdAt: new Date(2022, 10, 16).getTime(),
    updatedAt: new Date(2022, 10, 18).getTime(),
    timestamp: new Date(2022, 10, 18).getTime(),
    archived: false,
  };

  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
  t.deepEqual(response.results[0], expectedResponse);
  queryStringParameters = {
    limit: 50,
    parentArn__exists: 'true',
  };
  dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 24);
  t.is(response.results?.length, 24);
  queryStringParameters = {
    limit: 50,
    parentArn__in: ['fakeArn__21:fakeExecutionName', 'testArn__22:testExecutionName'].join(','),
  };
  dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 2);
  t.is(response.results?.length, 2);
  queryStringParameters = {
    limit: 50,
    parentArn__not: 'testArn__2:testExecutionName',
  };
  dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 23);
  t.is(response.results?.length, 23);
});

test.serial('ExecutionS3Search supports error.Error terms search', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 50,
    'error.Error__in': ['CumulusMessageAdapterError', 'UnknownError'].join(','),
  };
  let dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 20);
  t.is(response.results?.length, 20);

  queryStringParameters = {
    limit: 50,
    'error.Error__in': 'unknownerror',
  };
  dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 0);
  t.is(response.results?.length, 0);
});

test.serial('ExecutionS3Search supports search which checks existence of execution field', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 50,
    duration__exists: 'true',
  };
  const dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 49);
  t.is(response.results?.length, 49);
});

test.serial('ExecutionS3Search supports search which execution field does not match the given value', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 50,
    status__not: 'completed',
  };
  const dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 33);
  t.is(response.results?.length, 33);
});

test.serial('ExecutionS3Search supports term search for timestamp', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 50,
    timestamp: `${(new Date(2023, 11, 7)).getTime()}`,
  };
  let dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
  queryStringParameters = {
    limit: 200,
    timestamp__from: `${(new Date(2019, 2, 21)).getTime()}`,
    timestamp__to: `${(new Date(2027, 1, 23)).getTime()}`,
  };
  dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 36);
  t.is(response.results?.length, 36);
});

test.serial('ExecutionS3Search supports term search for date field', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 50,
    updatedAt: `${new Date(2018, 0, 20).getTime()}`,
  };
  const dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test.serial('ExecutionS3Search includeFullRecord', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    estimateTableRowCount: 'false',
    limit: 50,
    includeFullRecord: 'true',
  };

  const dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  const results = await dbSearch.query();
  t.is(results.meta.count, 50);
  t.is(results.results.length, 50);
  const expectedResponse1 = {
    name: 'testExecutionName',
    status: 'failed',
    arn: 'testArn__0:testExecutionName',
    error: { Error: 'UnknownError' },
    originalPayload: { orginal: 'payload__0' },
    finalPayload: { final: 'payload__0' },
    type: 'testWorkflow__0',
    execution: 'https://fake-execution0.com/',
    asyncOperationId: t.context.testAsyncOperation.id,
    collectionId: 'testCollection___8',
    createdAt: new Date(2017, 11, 31).getTime(),
    updatedAt: new Date(2018, 0, 1).getTime(),
    timestamp: new Date(2018, 0, 1).getTime(),
    archived: false,
  };

  const expectedResponse40 = {
    name: 'testExecutionName',
    status: 'completed',
    arn: 'testArn__40:testExecutionName',
    duration: 100,
    error: { Error: 'UnknownError' },
    originalPayload: { orginal: 'payload__40' },
    finalPayload: { final: 'payload__40' },
    type: 'testWorkflow__40',
    execution: 'https://fake-execution40.com/',
    asyncOperationId: t.context.testAsyncOperation.id,
    collectionId: 'testCollection___8',
    parentArn: 'fakeArn__15:fakeExecutionName',
    createdAt: new Date(2022, 4, 10).getTime(),
    updatedAt: new Date(2022, 4, 12).getTime(),
    timestamp: new Date(2022, 4, 12).getTime(),
    archived: false,
  };

  t.deepEqual(results.results[0], expectedResponse1);
  t.deepEqual(results.results[40], expectedResponse40);
});

test.serial('ExecutionS3Search estimates the rowcount of the table by default', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 50,
  };
  const dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.true(response.meta.count > 0, 'Expected response.meta.count to be greater than 0');
  t.is(response.results?.length, 50);
});

test.serial('ExecutionS3Search only returns count if countOnly is set to true', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    countOnly: 'true',
  };
  const dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.true(response.meta.count > 0, 'Expected response.meta.count to be greater than 0');
  t.is(response.results?.length, 0);
});

test.serial('ExecutionS3Search with archived: true pulls only archive granules', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    archived: true,
  };
  const dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  response.results.forEach((ExecutionRecord) => {
    t.is(ExecutionRecord.archived, true);
  });
});

test.serial('ExecutionS3Search with archived: false pulls only non-archive granules', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    archived: false,
  };
  const dbSearch = new ExecutionS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  response.results.forEach((ExecutionRecord) => {
    t.is(ExecutionRecord.archived, false);
  });
});

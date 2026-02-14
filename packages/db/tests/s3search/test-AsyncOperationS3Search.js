'use strict';

const test = require('ava');
const knex = require('knex');
const cryptoRandomString = require('crypto-random-string');
const { v4: uuidv4 } = require('uuid');
const omit = require('lodash/omit');
const range = require('lodash/range');
const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { createDuckDBWithS3, createDuckDBTableFromData, createDuckDBTables } = require('../../dist/test-duckdb-utils');
const {
  asyncOperationsS3TableSql,
} = require('../../dist/s3search/s3TableSchemas');
const { AsyncOperationS3Search } = require('../../dist/s3search/AsyncOperationS3Search');
const {
  translatePostgresAsyncOperationToApiAsyncOperation,
} = require('../../dist/translate/async_operations');
const {
  fakeAsyncOperationRecordFactory,
} = require('../../dist');

test.before(async (t) => {
  t.context.knexBuilder = knex({ client: 'pg' });

  t.context.asyncOperationSearchTimestamp = 1579352700000;
  t.context.asyncOperations = range(100).map((num) => (
    fakeAsyncOperationRecordFactory({
      cumulus_id: num,
      updated_at: new Date(t.context.asyncOperationSearchTimestamp + (num % 2)),
      operation_type: num % 2 === 0 ? 'Bulk Granules' : 'Data Migration',
      task_arn: num % 2 === 0 ? cryptoRandomString({ length: 3 }) : undefined,
    })
  ));

  const { instance, connection } = await createDuckDBWithS3();
  t.context.instance = instance;
  t.context.connection = connection;

  t.context.testBucket = cryptoRandomString({ length: 10 });
  await s3().createBucket({ Bucket: t.context.testBucket });
  await createDuckDBTables(connection);

  const duckdbS3Prefix = `s3://${t.context.testBucket}/duckdb/`;

  console.log('create asyncOperation');
  await createDuckDBTableFromData(
    connection,
    t.context.knexBuilder,
    'async_operations',
    asyncOperationsS3TableSql,
    t.context.asyncOperations,
    `${duckdbS3Prefix}async_operations.parquet`
  );
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.testBucket);
  await t.context.connection.closeSync();
});

test.serial('AsyncOperationS3Search returns 10 async operations by default', async (t) => {
  const { connection } = t.context;
  const dbSearch = new AsyncOperationS3Search({}, connection);
  const { results, meta } = await dbSearch.query();
  t.is(meta.count, 100);
  t.is(results.length, 10);
});

test.serial('AsyncOperationS3Search supports page and limit params', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 20,
    page: 2,
  };
  let dbSearch = new AsyncOperationS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 20);

  queryStringParameters = {
    limit: 11,
    page: 10,
  };
  dbSearch = new AsyncOperationS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 1);

  queryStringParameters = {
    limit: 10,
    page: 11,
  };
  dbSearch = new AsyncOperationS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 0);
});

test.serial('AsyncOperationS3Search supports infix search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 20,
    infix: t.context.asyncOperations[5].id.slice(1),
  };
  const dbSearch = new AsyncOperationS3Search({ queryStringParameters }, connection);
  const { results, meta } = await dbSearch.query();
  t.is(meta.count, 1);
  t.is(results?.length, 1);
});

test.serial('AsyncOperationS3Search supports prefix search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 20,
    prefix: t.context.asyncOperations[5].id.slice(0, -1),
  };
  const dbSearch = new AsyncOperationS3Search({ queryStringParameters }, connection);
  const { results, meta } = await dbSearch.query();
  t.is(meta.count, 1);
  t.is(results?.length, 1);
});

test.serial('AsyncOperationS3Search supports term search for uuid field', async (t) => {
  const { connection } = t.context;
  const dbRecord = t.context.asyncOperations[5];
  const queryStringParameters = {
    limit: 200,
    id: dbRecord.id,
  };
  const dbSearch = new AsyncOperationS3Search({ queryStringParameters }, connection);
  const { results, meta } = await dbSearch.query();
  t.is(meta.count, 1);
  t.is(results?.length, 1);
});

test.serial('AsyncOperationS3Search supports term search for date field', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    updatedAt: `${t.context.asyncOperationSearchTimestamp + 1}`,
  };
  const dbSearch = new AsyncOperationS3Search({ queryStringParameters }, connection);
  const { results, meta } = await dbSearch.query();
  t.is(meta.count, 50);
  t.is(results?.length, 50);
});

test.serial('AsyncOperationS3Search supports term search for _id field', async (t) => {
  const { connection } = t.context;
  const dbRecord = t.context.asyncOperations[5];
  const queryStringParameters = {
    limit: 200,
    _id: dbRecord.id,
  };
  const dbSearch = new AsyncOperationS3Search({ queryStringParameters }, connection);
  const { results, meta } = await dbSearch.query();
  t.is(meta.count, 1);
  t.is(results?.length, 1);
});

test.serial('AsyncOperationS3Search supports term search for string field', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    operationType: 'Bulk Granules',
  };
  const dbSearch = new AsyncOperationS3Search({ queryStringParameters }, connection);
  const { results, meta } = await dbSearch.query();
  t.is(meta.count, 50);
  t.is(results?.length, 50);
});

test.serial('AsyncOperationS3Search supports range search', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    timestamp__from: `${t.context.asyncOperationSearchTimestamp + 1}`,
    timestamp__to: `${t.context.asyncOperationSearchTimestamp + 2}`,
  };
  const dbSearch = new AsyncOperationS3Search({ queryStringParameters }, connection);
  const { results, meta } = await dbSearch.query();
  t.is(meta.count, 50);
  t.is(results?.length, 50);
});

test.serial('AsyncOperationS3Search supports search for multiple fields', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    id: t.context.asyncOperations[2].id,
    updatedAt: `${t.context.asyncOperationSearchTimestamp}`,
  };
  const dbSearch = new AsyncOperationS3Search({ queryStringParameters }, connection);
  const { results, meta } = await dbSearch.query();
  t.is(meta.count, 1);
  t.is(results?.length, 1);
});

test.serial('AsyncOperationS3Search non-existing fields are ignored', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    non_existing_field: `non_exist_${cryptoRandomString({ length: 5 })}`,
    non_existing_field__from: `non_exist_${cryptoRandomString({ length: 5 })}`,
  };
  const dbSearch = new AsyncOperationS3Search({ queryStringParameters }, connection);
  const { results, meta } = await dbSearch.query();
  t.is(meta.count, 100);
  t.is(results?.length, 100);
});

test.serial('AsyncOperationS3Search returns fields specified', async (t) => {
  const { connection } = t.context;
  const fields = 'id,operationType,status,taskArn';
  const queryStringParameters = {
    fields,
  };
  const dbSearch = new AsyncOperationS3Search({ queryStringParameters }, connection);
  const { results, meta } = await dbSearch.query();
  t.is(meta.count, 100);
  t.is(results?.length, 10);
  results.forEach((asyncOperation) => t.deepEqual(Object.keys(asyncOperation), fields.split(',')));
});

test.serial('AsyncOperationS3Search supports sorting', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    sort_by: 'id',
    order: 'asc',
  };
  const dbSearch = new AsyncOperationS3Search({ queryStringParameters }, connection);
  const response = await dbSearch.query();
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);
  t.true(response.results[0].id < response.results[99].id);
  t.true(response.results[0].id < response.results[50].id);

  queryStringParameters = {
    limit: 200,
    sort_key: ['-id'],
  };
  const dbSearch2 = new AsyncOperationS3Search({ queryStringParameters }, connection);
  const response2 = await dbSearch2.query();
  t.is(response2.meta.count, 100);
  t.is(response2.results?.length, 100);
  t.true(response2.results[0].id > response2.results[99].id);
  t.true(response2.results[0].id > response2.results[50].id);

  queryStringParameters = {
    limit: 200,
    sort_by: 'operationType',
  };
  const dbSearch3 = new AsyncOperationS3Search({ queryStringParameters }, connection);
  const response3 = await dbSearch3.query();
  t.is(response3.meta.count, 100);
  t.is(response3.results?.length, 100);
  t.true(response3.results[0].operationType < response3.results[99].operationType);
  t.true(response3.results[49].operationType < response3.results[50].operationType);
});

test.serial('AsyncOperationS3Search supports terms search', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    operationType__in: ['Bulk Granules', 'NOTEXIST'].join(','),
  };
  let dbSearch = new AsyncOperationS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    operationType__in: ['Bulk Granules', 'NOTEXIST'].join(','),
    _id__in: [t.context.asyncOperations[2].id, uuidv4()].join(','),
  };
  dbSearch = new AsyncOperationS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test.serial('AsyncOperationS3Search supports search when asyncOperation field does not match the given value', async (t) => {
  const { connection } = t.context;
  let queryStringParameters = {
    limit: 200,
    operationType__not: 'Bulk Granules',
  };
  let dbSearch = new AsyncOperationS3Search({ queryStringParameters }, connection);
  let response = await dbSearch.query();
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    operationType__not: 'Bulk Granules',
    id__not: t.context.asyncOperations[1].id,
  };
  dbSearch = new AsyncOperationS3Search({ queryStringParameters }, connection);
  response = await dbSearch.query();
  t.is(response.meta.count, 49);
  t.is(response.results?.length, 49);
});

test.serial('AsyncOperationS3Search supports search which checks existence of asyncOperation field', async (t) => {
  const { connection } = t.context;
  const queryStringParameters = {
    limit: 200,
    taskArn__exists: 'false',
    output_exists: 'true',
  };
  const dbSearch = new AsyncOperationS3Search({ queryStringParameters }, connection);
  const { results, meta } = await dbSearch.query();
  t.is(meta.count, 50);
  t.is(results?.length, 50);
});

test.serial('AsyncOperationS3Search returns the correct record', async (t) => {
  const { connection } = t.context;
  const dbRecord = t.context.asyncOperations[2];
  const queryStringParameters = {
    limit: 200,
    id: dbRecord.id,
  };
  const dbSearch = new AsyncOperationS3Search({ queryStringParameters }, connection);
  const { results, meta } = await dbSearch.query();
  t.is(meta.count, 1);
  t.is(results?.length, 1);
  const expectedApiRecord = translatePostgresAsyncOperationToApiAsyncOperation(dbRecord);
  t.deepEqual(omit(results?.[0], 'createdAt'), omit(expectedApiRecord, 'createdAt'));
  t.truthy(results?.[0]?.createdAt);
});

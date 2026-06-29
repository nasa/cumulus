'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const sinon = require('sinon');

const { AthenaQueryClient } = require('../AthenaQueryClient');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('../S3');

const randomString = () => cryptoRandomString({
  length: 10,
  characters: 'abcdefghijklmnopqrstuvwxyz', // https://docs.aws.amazon.com/athena/latest/ug/tables-databases-columns-names.html
});

test.before(async (t) => {
  t.context.Bucket = randomString();
  await createBucket(t.context.Bucket);

  t.context.db = `${randomString()}_testdb`;

  t.context.client = new AthenaQueryClient({
    ClientConfig: {
      region: 'us-east-1',
      endpoint: 'http://localhost:4566',
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    },
    Database: t.context.db,
    ResultConfiguration: { OutputLocation: `s3://${t.context.Bucket}/` },
  });
});

test.afterEach.always(() => {
  sinon.restore();
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.Bucket);
});

test('startQueryExecution() initiates a query and receives a QueryExecutionId response', async (t) => {
  const tableName = `${randomString()}_table`;
  const tableQuery = `CREATE TABLE IF NOT EXISTS ${tableName}
( bucket string, key string, version_id string, is_latest boolean, is_delete_marker boolean);`;

  const queryId = await t.context.client.startQueryExecution(tableQuery);
  console.log('queryId from startQuery:', queryId);
  t.is((typeof queryId), 'string');
});

test('mapData returns data in the expected format', (t) => {
  const testBucket = 'daac-public-bucket';
  const testKey = `${randomString()}`;

  const expected = [
    { bucket: testBucket, key: testKey, version_id: '', is_latest: true, is_delete_marker: false },
  ];

  // response is in the shape of GetQueryResultsCommand Output
  const response = {
    UpdateCount: 0,
    ResultSet: {
      Rows: [
        { Data: [
          { VarCharValue: 'bucket' },
          { VarCharValue: 'key' },
          { VarCharValue: 'version_id' },
          { VarCharValue: 'is_latest' },
          { VarCharValue: 'is_delete_marker' },
        ] },
        { Data: [
          { VarCharValue: testBucket },
          { VarCharValue: testKey },
          {},
          { VarCharValue: true },
          { VarCharValue: false },
        ] },
      ],
    },
  };
  const mappedResult = t.context.client.mapData(response.ResultSet);

  t.deepEqual(expected, mappedResult);
});

test('mapData() returns expected result when ResultSet is empty', (t) => {
  // responses have emtpy ResultSet.Rows from queries like create tables or views
  const response = {
    UpdateCount: 0,
    ResultSet: { Rows: [], ResultSetMetadata: { ColumnInfo: [] } },
  };
  const mappedResult = t.context.client.mapData(response.ResultSet);

  t.deepEqual([], mappedResult);
});

test('query() initiates a query, waits for it to finish, and returns the mapped response', async (t) => {
  // could not get ministack duckdb to find a table to perform operations on it,
  // even after verifying a create table query succeeeded
  // so using the mocked db version of Athena in ministack, which returns mock data
  const expected = [{ result: 'mock_value' }];

  const dbQuery = `CREATE DATABASE IF NOT EXISTS ${t.context.db}`;
  const dbResponse = await t.context.client.query(dbQuery);
  console.log(`data after createDb: ${JSON.stringify(dbResponse)}`);

  const tableName = `${randomString()}_table`;
  // create table
  const tableQuery = `CREATE TABLE IF NOT EXISTS ${tableName}
( bucket string, key string, version_id string, is_latest boolean, is_delete_marker boolean);`;
  await t.context.client.query(tableQuery);

  const testBucket = 'daac-public-bucket';
  const testKey = `${randomString()}`;
  // populate table
  const addDataQuery = `INSERT INTO ${tableName} VALUES ('${testBucket}', '${testKey}', '', true, false);`;
  await t.context.client.query(addDataQuery);

  // get data
  const getDataQuery = `SELECT * FROM ${tableName};`;
  const results = await t.context.client.query(getDataQuery);

  t.deepEqual(results, expected);
});

test('checkQueryExecutionStateAndGetData throws when getQueryExecution returns with a CANCELLED state', async (t) => {
  const tableName = `${randomString()}_table`;
  const tableQuery = `CREATE TABLE IF NOT EXISTS ${tableName}
( bucket string, key string, version_id string, is_latest boolean, is_delete_marker boolean);`;
  await t.context.client.query(tableQuery);

  const testBucket = 'daac-public-bucket';
  const testKey = `${randomString()}`;
  const addDataQuery = `INSERT INTO ${tableName} VALUES ('${testBucket}', '${testKey}', '', true, false);`;
  await t.context.client.query(addDataQuery);

  const abridgedResponse = {
    QueryExecution: {
      QueryExecutionId: '1234-abcd-5678-efgh',
      Query: '',
      ResultConfiguration: {
        OutputLocation: `s3://${t.context.Bucket}/`,
      },
      QueryExecutionContext: {
        Database: t.context.db,
      },
      Status: {
        State: 'CANCELLED',
        SubmissionDateTime: new Date().toISOString(),
      },
    },
  };

  sinon.stub(t.context.client, 'getQueryExecution')
    .callsFake(() => Promise.resolve(abridgedResponse));

  const getDataQuery = `SELECT * FROM ${tableName};`;
  await t.throwsAsync(
    t.context.client.query(getDataQuery),
    { message: 'Query was cancelled' }
  );
});

test('checkQueryExecutionStateAndGetData throws when getQueryExecution returns with a FAILED state', async (t) => {
  const tableName = `${randomString()}_table`;
  const tableQuery = `CREATE TABLE IF NOT EXISTS ${tableName}
( bucket string, key string, version_id string, is_latest boolean, is_delete_marker boolean);`;
  await t.context.client.query(tableQuery);

  const testBucket = 'daac-public-bucket';
  const testKey = `${randomString()}`;
  const addDataQuery = `INSERT INTO ${tableName} VALUES ('${testBucket}', '${testKey}', '', true, false);`;
  await t.context.client.query(addDataQuery);

  const abridgedResponse = {
    QueryExecution: {
      QueryExecutionId: '1234-abcd-5678-efgh',
      Query: '',
      ResultConfiguration: {
        OutputLocation: `s3://${t.context.Bucket}/`,
      },
      QueryExecutionContext: {
        Database: t.context.db,
      },
      Status: {
        State: 'FAILED',
        StateChangeReason: 'some failure reason',
        SubmissionDateTime: new Date().toISOString(),
      },
    },
  };

  sinon.stub(t.context.client, 'getQueryExecution')
    .callsFake(() => Promise.resolve(abridgedResponse));

  const getDataQuery = `SELECT * FROM ${tableName};`;
  await t.throwsAsync(
    t.context.client.query(getDataQuery),
    { message: 'Query failed: some failure reason' }
  );
});

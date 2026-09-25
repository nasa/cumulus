'use strict';

// TODO: Remove this comment when localstack is replaced:
// Athena client tests are unable to run using localstack local environment.
// Once localstack is replaced, these tests will need to be updated to use
// local AWS instances. This work should be completed in CUMULUS-5307.

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
} = require('@aws-sdk/client-athena');

const { mockClient } = require('aws-sdk-client-mock');

const { AthenaQueryClient } = require('../AthenaQueryClient');
const athenaClientMock = mockClient(AthenaClient);

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
  athenaClientMock.reset();
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.Bucket);
});

test('startQueryExecution() initiates a query and receives a QueryExecutionId response', async (t) => {
  athenaClientMock.on(StartQueryExecutionCommand).resolves({
    QueryExecutionId: '12345-abcde-67890',
  });
  const tableName = `${randomString()}_table`;
  const tableQuery = `CREATE TABLE IF NOT EXISTS ${tableName}
( bucket string, key string, version_id string, is_latest boolean, is_delete_marker boolean);`;

  const queryId = await t.context.client.startQueryExecution(tableQuery);
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

test.serial('query() initiates a query, waits for it to finish, and returns the mapped response', async (t) => {
  // create db
  const dbQuery = `CREATE DATABASE IF NOT EXISTS ${t.context.db}`;

  const startCreateDbResponse = { QueryExecutionId: '12345-abcde-67890' };
  athenaClientMock.on(StartQueryExecutionCommand).resolves(
    startCreateDbResponse
  );

  const createDbResponse = {
    QueryExecution: {
      QueryExecutionId: '12345-abcde-67890',
      Query: `CREATE DATABASE IF NOT EXISTS ${t.context.db}`,
      ResultConfiguration: {
        OutputLocation: `s3://${t.context.Bucket}/`,
      },
      QueryExecutionContext: {
        Database: t.context.db,
      },
      Status: {
        State: 'SUCCEEDED',
        SubmissionDateTime: new Date().toISOString(),
      },
    },
  };
  athenaClientMock.on(GetQueryExecutionCommand).resolves(
    createDbResponse
  );

  const createQueryResponse = {
    ResultSet: { Rows: [], ResultSetMetadata: { ColumnInfo: [] } },
  };
  athenaClientMock.on(GetQueryResultsCommand).resolves(
    createQueryResponse
  );

  await t.context.client.query(dbQuery);

  // create table
  const tableName = `${randomString()}_table`;
  const tableQuery = `CREATE TABLE IF NOT EXISTS ${tableName}
  ( bucket string, key string, version_id string, is_latest boolean, is_delete_marker boolean);`;

  const startCreateTableResponse = { QueryExecutionId: '1234-abcd-5678-efgh' };
  athenaClientMock.on(StartQueryExecutionCommand).resolves(
    startCreateTableResponse
  );

  const createTableResponse = {
    QueryExecution: {
      QueryExecutionId: '1234-abcd-5678-efgh',
      Query: `CREATE DATABASE IF NOT EXISTS ${t.context.db}
( bucket string, key string, version_id string, is_latest boolean, is_delete_marker boolean);`,
      ResultConfiguration: {
        OutputLocation: `s3://${t.context.Bucket}/`,
      },
      QueryExecutionContext: {
        Database: t.context.db,
      },
      Status: {
        State: 'SUCCEEDED',
        SubmissionDateTime: new Date().toISOString(),
      },
    },
  };
  athenaClientMock.on(GetQueryExecutionCommand).resolves(
    createTableResponse
  );
  // create table get query results will be the same

  await t.context.client.query(tableQuery);

  // populate table
  const testBucket = 'daac-public-bucket';
  const testKey = `${randomString()}`;

  const addDataQuery = `INSERT INTO ${tableName} VALUES ('${testBucket}', '${testKey}', '', true, false);`;

  const startAddDataResponse = { QueryExecutionId: '2345-ijkl-6789-mnop' };
  athenaClientMock.on(StartQueryExecutionCommand).resolves(
    startAddDataResponse
  );

  const addDataResponse = {
    QueryExecution: {
      QueryExecutionId: '2345-ijkl-6789-mnop',
      Query: `INSERT INTO ${tableName} VALUES ('${testBucket}', '${testKey}', '', true, false);`,
      ResultConfiguration: {
        OutputLocation: `s3://${t.context.Bucket}/`,
      },
      QueryExecutionContext: {
        Database: t.context.db,
      },
      Status: {
        State: 'SUCCEEDED',
        SubmissionDateTime: new Date().toISOString(),
      },
    },
  };
  athenaClientMock.on(GetQueryExecutionCommand).resolves(
    addDataResponse
  );

  // not sure what the add Data response for get query results will be
  // but for now assuming it will be the same as the create queries
  await t.context.client.query(addDataQuery);

  // query to get data
  const getDataQuery = `SELECT * FROM ${tableName};`;

  const startGetDataResponse = { QueryExecutionId: '3456-qrst-7890-uvwx' };
  athenaClientMock.on(StartQueryExecutionCommand).resolves(
    startGetDataResponse
  );

  const getDataExecutionResponse = {
    QueryExecution: {
      QueryExecutionId: '3456-qrst-7890-uvwx',
      Query: `SELECT * FROM ${tableName};`,
      ResultConfiguration: {
        OutputLocation: `s3://${t.context.Bucket}/`,
      },
      QueryExecutionContext: {
        Database: t.context.db,
      },
      Status: {
        State: 'SUCCEEDED',
        SubmissionDateTime: new Date().toISOString(),
      },
    },
  };
  athenaClientMock.on(GetQueryExecutionCommand).resolves(
    getDataExecutionResponse
  );

  const getDataResultsResponse = {
    UpdateCount: 0,
    ResultSet: {
      Rows: [
        {
          Data: [
            { VarCharValue: 'bucket' },
            { VarCharValue: 'key' },
            { VarCharValue: 'version_id' },
            { VarCharValue: 'is_latest' },
            { VarCharValue: 'is_delete_marker' },
          ],
        },
        {
          Data: [
            { VarCharValue: testBucket },
            { VarCharValue: testKey },
            {},
            { VarCharValue: true },
            { VarCharValue: false },
          ],
        },
      ],
    },
  };
  athenaClientMock.on(GetQueryResultsCommand).resolves(
    getDataResultsResponse
  );

  const results = await t.context.client.query(getDataQuery);

  const expected = [
    { bucket: testBucket, key: testKey, version_id: '', is_latest: true, is_delete_marker: false },
  ];

  t.deepEqual(results, expected);
});

test.serial('checkQueryExecutionStateAndGetData throws when getQueryExecution returns with a CANCELLED state', async (t) => {
  // create table
  const tableName = `${randomString()}_table`;
  const tableQuery = `CREATE TABLE IF NOT EXISTS ${tableName}
  ( bucket string, key string, version_id string, is_latest boolean, is_delete_marker boolean);`;

  const startCreateTableResponse = { QueryExecutionId: '1234-abcd-5678-efgh' };
  athenaClientMock.on(StartQueryExecutionCommand).resolves(
    startCreateTableResponse
  );

  const createTableResponse = {
    QueryExecution: {
      QueryExecutionId: '1234-abcd-5678-efgh',
      Query: `CREATE DATABASE IF NOT EXISTS ${t.context.db}
( bucket string, key string, version_id string, is_latest boolean, is_delete_marker boolean);`,
      ResultConfiguration: {
        OutputLocation: `s3://${t.context.Bucket}/`,
      },
      QueryExecutionContext: {
        Database: t.context.db,
      },
      Status: {
        State: 'SUCCEEDED',
        SubmissionDateTime: new Date().toISOString(),
      },
    },
  };
  athenaClientMock.on(GetQueryExecutionCommand).resolves(
    createTableResponse
  );

  const createQueryResponse = {
    ResultSet: { Rows: [], ResultSetMetadata: { ColumnInfo: [] } },
  };
  athenaClientMock.on(GetQueryResultsCommand).resolves(
    createQueryResponse
  );

  await t.context.client.query(tableQuery);

  // populate table
  const testBucket = 'daac-public-bucket';
  const testKey = `${randomString()}`;
  const addDataQuery = `INSERT INTO ${tableName} VALUES ('${testBucket}', '${testKey}', '', true, false);`;

  const startAddDataResponse = { QueryExecutionId: '2345-ijkl-6789-mnop' };
  athenaClientMock.on(StartQueryExecutionCommand).resolves(
    startAddDataResponse
  );

  const addDataResponse = {
    QueryExecution: {
      QueryExecutionId: '2345-ijkl-6789-mnop',
      Query: `INSERT INTO ${tableName} VALUES ('${testBucket}', '${testKey}', '', true, false);`,
      ResultConfiguration: {
        OutputLocation: `s3://${t.context.Bucket}/`,
      },
      QueryExecutionContext: {
        Database: t.context.db,
      },
      Status: {
        State: 'SUCCEEDED',
        SubmissionDateTime: new Date().toISOString(),
      },
    },
  };
  athenaClientMock.on(GetQueryExecutionCommand).resolves(
    addDataResponse
  );

  // not sure what the add Data response for get query results will be
  // but for now assuming it will be the same as the create queries

  await t.context.client.query(addDataQuery);

  // query for data
  const getDataQuery = `SELECT * FROM ${tableName};`;

  const startGetDataResponse = { QueryExecutionId: '3456-qrst-7890-uvwx' };
  athenaClientMock.on(StartQueryExecutionCommand).resolves(
    startGetDataResponse
  );

  const getDataExecutionResponse = {
    QueryExecution: {
      QueryExecutionId: '3456-qrst-7890-uvwx',
      Query: `SELECT * FROM ${tableName};`,
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

  athenaClientMock.on(GetQueryExecutionCommand).resolves(
    getDataExecutionResponse
  );

  await t.throwsAsync(
    t.context.client.query(getDataQuery),
    { message: 'Query was cancelled' }
  );
});

test.serial('checkQueryExecutionStateAndGetData throws when getQueryExecution returns with a FAILED state', async (t) => {
  const tableName = `${randomString()}_table`;
  const tableQuery = `CREATE TABLE IF NOT EXISTS ${tableName}
( bucket string, key string, version_id string, is_latest boolean, is_delete_marker boolean);`;

  const testBucket = 'daac-public-bucket';
  const testKey = `${randomString()}`;
  const addDataQuery = `INSERT INTO ${tableName} VALUES ('${testBucket}', '${testKey}', '', true, false);`;

  const startCreateTableResponse = { QueryExecutionId: '1234-abcd-5678-efgh' };
  athenaClientMock.on(StartQueryExecutionCommand).resolves(
    startCreateTableResponse
  );
  const addDataResponse = {
    QueryExecution: {
      QueryExecutionId: '2345-ijkl-6789-mnop',
      Query: `INSERT INTO ${tableName} VALUES ('${testBucket}', '${testKey}', '', true, false);`,
      ResultConfiguration: {
        OutputLocation: `s3://${t.context.Bucket}/`,
      },
      QueryExecutionContext: {
        Database: t.context.db,
      },
      Status: {
        State: 'SUCCEEDED',
        SubmissionDateTime: new Date().toISOString(),
      },
    },
  };
  athenaClientMock.on(GetQueryExecutionCommand).resolves(
    addDataResponse
  );

  const createQueryResponse = {
    ResultSet: { Rows: [], ResultSetMetadata: { ColumnInfo: [] } },
  };
  athenaClientMock.on(GetQueryResultsCommand).resolves(
    createQueryResponse
  );

  await t.context.client.query(tableQuery);

  await t.context.client.query(addDataQuery);

  const getDataQuery = `SELECT * FROM ${tableName};`;

  const getDataExecutionResponse = {
    QueryExecution: {
      QueryExecutionId: '2345-ijkl-6789-mnop',
      Query: `INSERT INTO ${tableName} VALUES ('${testBucket}', '${testKey}', '', true, false);`,
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
  athenaClientMock.on(GetQueryExecutionCommand).resolves(
    getDataExecutionResponse
  );

  await t.throwsAsync(
    t.context.client.query(getDataQuery),
    { message: 'Query failed: some failure reason' }
  );
});

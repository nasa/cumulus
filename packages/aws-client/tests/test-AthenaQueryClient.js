'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { S3Client, CreateBucketCommand } = require('@aws-sdk/client-s3');
const { StartQueryExecutionCommand } = require('@aws-sdk/client-athena');
const awsServices = require('../services');
const { AthenaQueryClient } = require('../AthenaQueryClient');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('../S3');
const { random } = require('lodash');

const randomString = () => cryptoRandomString({
  length: 10,
  characters: 'abcdefghijklmnopqrstuvwxyz', // https://docs.aws.amazon.com/athena/latest/ug/tables-databases-columns-names.html
});

test.before(async (t) => {
  // const s3 = new S3Client({
  //   endpoint: 'http://localhost:4566',
  //   region: 'us-east-1',
  //   credentials: {
  //     accessKeyId: 'test',
  //     secretAccessKey: 'test',
  //   },
  // });
  t.context.Bucket = randomString();
  const resp2 = await createBucket(t.context.Bucket);
  // const resp2 = await s3.send(new CreateBucketCommand({ Bucket: t.context.Bucket }));
  console.log(`resp after send createBucket: ${JSON.stringify(resp2)}`);
  // t.context.BucketLocation = resp2.Location;

  t.context.db = 'testing_athena_db';
  // t.context.client = new AthenaQueryClient({
  //   ClientConfig: { region: 'us-east-1' },
  //   Database: t.context.db,
  //   ResultConfiguration: { OutputLocation: t.context.Bucket },
  // });
  // t.context.client = awsServices.athena(); // works, but not the client I wrote

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

  // const dbQuery = `CREATE DATABASE IF NOT EXISTS ${t.context.db}`;
  // const dbResponse = await t.context.client.query(dbQuery);
  // console.log(`data after createDb: ${JSON.stringify(dbResponse)}`);
  // const resp1 = await t.context.client.send(new StartQueryExecutionCommand(dbQuery));
  // console.log(`data after send createDb: ${JSON.stringify(resp1)}`);
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.Bucket);
});

// TODO: how to populate data into table?

// https://docs.localstack.cloud/aws/services/athena/

// test start query command
// set up basic client
// provide db name
// create db
// create table?
// ---
// create bucket
test('startQueryExecution() initiates a query and receives a QueryExecutionId response', async (t) => {

  // const client = new AthenaQueryClient({
  //       ClientConfig: { region: 'us-east-1' },
  //       Database: testDb,
  //       ResultConfiguration: { OutputLocation: outputS3Location },
  //     });
  const tableName = `${randomString()}_table`;
  const tableQuery = `CREATE TABLE IF NOT EXISTS ${tableName}
( bucket string, key string, version_id string, is_latest boolean, is_delete_marker boolean);`;

  const queryId = await t.context.client.startQueryExecution(tableQuery);
  console.log('queryId from startQuery:', queryId);
  t.is((typeof queryId), 'string');
});

// test mapData
// need data in format from Athena GetQueryResultsCommand
// pass in, ensure getting back as ___
test('mapData returns data in the expected format', (t) => {
  const testBucket = 'daac-public-bucket';
  const testKey = `${randomString()}`;

  const expected = [
    { bucket: testBucket, key: testKey, version_id: '', is_latest: true, is_delete_marker: false },
  ];
  // const tableName = 'duckdb_tables';
//   const tableName = `${randomString()}_tbl`;
//   const tableQuery = `CREATE TABLE IF NOT EXISTS ${tableName}
// ( bucket string, key string, version_id string, is_latest boolean, is_delete_marker boolean);`;
//   await t.context.client.query(tableQuery);

//   const testQuery = 'SHOW TABLES;';
//   const data = await t.context.client.query(testQuery);
//   console.log(JSON.stringify(data));

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

  // populate table
  // const addDataQuery = `INSERT INTO ${tableName} VALUES ('${testBucket}', '${testKey}', '', true, false);`;
  // await t.context.client.query(addDataQuery);

  // // get data
  // const getDataQuery = `SELECT * FROM ${tableName};`;
  // const results = await t.context.client.query(getDataQuery);

  t.deepEqual(expected, mappedResult);
});

test('mapData returns expected result when ResultSet is empty', (t) => {
  // responses have emtpy ResultSet.Rows from queries like create tables or views
  const response = {
    UpdateCount: 0,
    ResultSet: { Rows: [], ResultSetMetadata: { ColumnInfo: [] } },
  };
  const mappedResult = t.context.client.mapData(response.ResultSet);

  t.deepEqual([], mappedResult);
});

// test get query results
// start query (create db, table
// populate data
// run basic query getting data
// ensure output is in format like ___

// test checkQueryExecutionStateAndGetData
// need to test different states?
// need to test timing? how to mock result to test time
// test start query -> check -> success -> mapped data

// test `query`

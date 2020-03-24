'use strict';

const sinon = require('sinon');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const { RecordDoesNotExist } = require('@cumulus/errors');
const DynamoDb = require('../DynamoDb');
const awsServices = require('../services');

test.before(async () => {
  process.env.tableName = `table${cryptoRandomString({ length: 10 })}`;

  await awsServices.dynamodb().createTable({
    TableName: process.env.tableName,
    AttributeDefinitions: [
      { AttributeName: 'hash', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'hash', KeyType: 'HASH' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  }).promise();
});

test.beforeEach(async (t) => {
  t.context.client = awsServices.dynamodbDocClient();
});

test.after.always(
  () => awsServices.dynamodb().deleteTable({ TableName: process.env.tableName }).promise()
);

test('DynamoDb.get() returns an existing item', async (t) => {
  const { client } = t.context;
  const hash = `hash${cryptoRandomString({ length: 10 })}`;
  const item = {
    hash,
    foo: 'bar'
  };

  await client.put({
    TableName: process.env.tableName,
    Item: item
  }).promise();

  const response = await DynamoDb.get({
    tableName: process.env.tableName,
    client,
    item: {
      hash
    }
  });

  t.deepEqual(response, item);
});

test('DynamoDb.get() throws RecordDoesNotExist when item does not exist', async (t) => {
  const { client } = t.context;

  await t.throwsAsync(
    () => DynamoDb.get({
      tableName: process.env.tableName,
      client,
      item: {
        hash: `hash${cryptoRandomString({ length: 10 })}`
      }
    }),
    RecordDoesNotExist
  );
});

test.serial('DynamoDb.get() throws general error from failure on client.get', async (t) => {
  const { client } = t.context;

  const stub = sinon.stub(client, 'get')
    .returns({
      promise: () => {
        throw new Error('fail');
      }
    });

  try {
    await t.throwsAsync(
      () => DynamoDb.get({
        tableName: process.env.tableName,
        client,
        item: {
          hash: `hash${cryptoRandomString({ length: 10 })}`
        }
      }),
      { message: /fail/ }
    );
  } finally {
    stub.restore();
  }
});

test.serial('DynamoDb.scan() properly returns all paginated results', async (t) => {
  const { client } = t.context;
  let count = 0;
  const total = 3;

  while (count < total) {
    // eslint-disable-next-line no-await-in-loop
    await client.put({
      TableName: process.env.tableName,
      Item: {
        hash: `hash${cryptoRandomString({ length: 10 })}`,
        foo: 'bar'
      }
    }).promise();
    count += 1;
  }

  const response = await DynamoDb.scan({
    tableName: process.env.tableName,
    client,
    limit: 2
  });

  t.is(response.Items.length, 3);
});

'use strict';

const test = require('ava');
const aws = require('../aws');
const { randomId } = require('../test-utils');
const DynamoDb = require('../DynamoDb');
const { RecordDoesNotExist } = require('../errors');

test.before(async () => {
  process.env.tableName = randomId('table');

  await aws.dynamodb().createTable({
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
  t.context.client = aws.dynamodbDocClient();
});

test.after.always(
  () => aws.dynamodb().deleteTable({ TableName: process.env.tableName }).promise()
);

test('DynamoDb.get() returns an existing item', async (t) => {
  const { client } = t.context;
  const hash = randomId('hash');
  const item = {
    hash,
    foo: 'bar'
  };

  await client.put({
    TableName: process.env.tableName,
    Item: item
  }).promise();

  const response = await DynamoDb.getItem({
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

  const error = await t.throws(DynamoDb.getItem({
    tableName: process.env.tableName,
    client,
    item: {
      hash: randomId('hash')
    }
  }));

  t.true(error instanceof RecordDoesNotExist);
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
        hash: randomId('hash'),
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

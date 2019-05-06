'use strict';

const test = require('ava');
const aws = require('../aws');
const { randomId } = require('../test-utils');
const DynamoDb = require('../DynamoDb');

test.before(async () => {
  process.env.tableName = randomId('table');

  await aws.dynamodb().createTable({
    TableName: process.env.tableName,
    AttributeDefinitions: [
      { AttributeName: 'key', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'key', KeyType: 'HASH' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  }).promise();
});

// test.beforeEach(async (t) => {
//   t.context.semaphore = new Semaphore(
//     dynamodbDocClient(),
//     process.env.SemaphoresTable
//   );
//   t.context.key = randomId('key');
// });

test.after.always(
  () => aws.dynamodb().deleteTable({ TableName: process.env.tableName }).promise()
);

test('DynamoDb.scan() properly returns all paginated results', async (t) => {
  const client = aws.dynamodbDocClient();
  let count = 0;
  const total = 3;

  while (count < total) {
    // eslint-disable-next-line no-await-in-loop
    await client.put({
      TableName: process.env.tableName,
      Item: {
        key: randomId('test'),
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

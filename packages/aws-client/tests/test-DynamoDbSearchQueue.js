'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');

const awsServices = require('../services');
const DynamoDb = require('../DynamoDb');
const DynamoDbSearchQueue = require('../DynamoDbSearchQueue');

const randomString = () => cryptoRandomString({ length: 10 });

test.beforeEach(async (t) => {
  t.context.tableName = randomString();

  await DynamoDb.createAndWaitForDynamoDbTable({
    TableName: t.context.tableName,
    AttributeDefinitions: [
      { AttributeName: 'bucket', AttributeType: 'S' },
      { AttributeName: 'key', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'bucket', KeyType: 'HASH' },
      { AttributeName: 'key', KeyType: 'RANGE' },
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5,
    },
  });
});

test.afterEach.always(
  (t) => DynamoDb.deleteAndWaitForDynamoDbTableNotExists({ TableName: t.context.tableName })
);

test.serial('DynamoDbSearchQueue.peek() returns the next item but does not remove it from the queue', async (t) => {
  const bucket = randomString();
  const key = randomString();

  await awsServices.dynamodb().putItem({
    TableName: t.context.tableName,
    Item: {
      bucket: { S: bucket },
      key: { S: key },
    },
  });

  const queue = new DynamoDbSearchQueue({ TableName: t.context.tableName });

  t.is((await queue.peek()).bucket, bucket);
  t.is((await queue.peek()).bucket, bucket);
});

test.serial('DynamoDbSearchQueue.shift() returns the next object and removes it from the queue', async (t) => {
  const bucket = randomString();
  const key = randomString();

  await awsServices.dynamodb().putItem({
    TableName: t.context.tableName,
    Item: {
      bucket: { S: bucket },
      key: { S: key },
    },
  });

  const queue = new DynamoDbSearchQueue({ TableName: t.context.tableName });

  t.is((await queue.peek()).bucket, bucket);
  t.is((await queue.shift()).bucket, bucket);
  t.is(await queue.peek(), null);
});

test.serial('DynamoDbSearchQueue can handle paging', async (t) => {
  await Promise.all(range(11).map(() =>
    awsServices.dynamodb().putItem({
      TableName: t.context.tableName,
      Item: {
        bucket: { S: randomString() },
        key: { S: randomString() },
      },
    })));

  const queue = new DynamoDbSearchQueue({
    TableName: t.context.tableName,
    Limit: 2,
  });

  let returnedItemsCount = 0;
  let nextItem = await queue.shift();
  while (nextItem) {
    returnedItemsCount += 1;
    nextItem = await queue.shift(); // eslint-disable-line no-await-in-loop
  }

  t.is(returnedItemsCount, 11);
});

test.serial('DynamoDbSearchQueue returns results with searchType set to "query"', async (t) => {
  const bucket = randomString();

  await Promise.all(range(11).map(() =>
    awsServices.dynamodb().putItem({
      TableName: t.context.tableName,
      Item: {
        bucket: { S: bucket },
        key: { S: randomString() },
      },
    })));

  const queue = new DynamoDbSearchQueue(
    {
      TableName: t.context.tableName,
      Limit: 2,
      KeyConditionExpression: '#bucket = :bucket',
      ExpressionAttributeNames: {
        '#bucket': 'bucket',
      },
      ExpressionAttributeValues: {
        ':bucket': bucket,
      },
    },
    'query'
  );

  let returnedItemsCount = 0;
  let nextItem = await queue.shift();
  while (nextItem) {
    returnedItemsCount += 1;
    nextItem = await queue.shift(); // eslint-disable-line no-await-in-loop
  }

  t.is(returnedItemsCount, 11);
});

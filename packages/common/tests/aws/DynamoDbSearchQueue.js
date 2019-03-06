'use strict';

const test = require('ava');
const range = require('lodash.range');

const {
  dynamodb,
  DynamoDbSearchQueue
} = require('../../aws');
const { randomString } = require('../../test-utils');

test.beforeEach(async (t) => {
  t.context.tableName = randomString();

  await dynamodb().createTable({
    TableName: t.context.tableName,
    AttributeDefinitions: [
      { AttributeName: 'bucket', AttributeType: 'S' },
      { AttributeName: 'key', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'bucket', KeyType: 'HASH' },
      { AttributeName: 'key', KeyType: 'RANGE' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  }).promise();

  return dynamodb().waitFor('tableExists', { TableName: t.context.tableName }).promise();
});

test.afterEach.always((t) => dynamodb().deleteTable({ TableName: t.context.tableName }).promise());

test.serial('DynamoDbSearchQueue.peek() returns the next item but does not remove it from the queue', async (t) => {
  const bucket = randomString();
  const key = randomString();

  await dynamodb().putItem({
    TableName: t.context.tableName,
    Item: {
      bucket: { S: bucket },
      key: { S: key }
    }
  }).promise();

  const queue = new DynamoDbSearchQueue({ TableName: t.context.tableName });

  t.is((await queue.peek()).bucket, bucket);
  t.is((await queue.peek()).bucket, bucket);
});

test.serial('DynamoDbSearchQueue.shift() returns the next object and removes it from the queue', async (t) => {
  const bucket = randomString();
  const key = randomString();

  await dynamodb().putItem({
    TableName: t.context.tableName,
    Item: {
      bucket: { S: bucket },
      key: { S: key }
    }
  }).promise();

  const queue = new DynamoDbSearchQueue({ TableName: t.context.tableName });

  t.is((await queue.peek()).bucket, bucket);
  t.is((await queue.shift()).bucket, bucket);
  t.is(await queue.peek(), null);
});

test.serial('DynamoDbSearchQueue can handle paging', async (t) => {
  await Promise.all(range(11).map(() =>
    dynamodb().putItem({
      TableName: t.context.tableName,
      Item: {
        bucket: { S: randomString() },
        key: { S: randomString() }
      }
    }).promise()));

  const queue = new DynamoDbSearchQueue({
    TableName: t.context.tableName,
    Limit: 2
  });

  let returnedItemsCount = 0;
  let nextItem = await queue.shift();
  while (nextItem) {
    returnedItemsCount += 1;
    nextItem = await queue.shift(); // eslint-disable-line no-await-in-loop
  }

  t.is(returnedItemsCount, 11);
});

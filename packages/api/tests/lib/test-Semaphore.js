'use strict';

const test = require('ava');
const DynamoDb = require('@cumulus/aws-client/DynamoDb');
const { dynamodb, dynamodbDocClient } = require('@cumulus/aws-client/services');
const { randomId } = require('@cumulus/common/test-utils');
const { ResourcesLockedError } = require('@cumulus/errors');
const Semaphore = require('../../lib/Semaphore');

test.before(async () => {
  process.env.SemaphoresTable = randomId('SemaphoresTable');

  await DynamoDb.createAndWaitForDynamoDbTable({
    TableName: process.env.SemaphoresTable,
    AttributeDefinitions: [
      { AttributeName: 'key', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'key', KeyType: 'HASH' },
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5,
    },
  });
});

test.beforeEach((t) => {
  t.context.semaphore = new Semaphore(
    dynamodbDocClient(),
    process.env.SemaphoresTable
  );
  t.context.key = randomId('key');
});

test.after.always(
  () => dynamodb().deleteTable({ TableName: process.env.SemaphoresTable })
);

test('Semaphore.create() initializes semaphore', async (t) => {
  const { semaphore, key } = t.context;

  await semaphore.create(key);
  const response = await semaphore.get(key);
  t.is(response.semvalue, 0);
});

test('Semaphore.create() on existing semaphore does not throw an error', async (t) => {
  const { semaphore, key } = t.context;

  await semaphore.create(key);

  await t.notThrowsAsync(() => semaphore.create(key));
});

test('Semaphore.add() can increase the semaphore value up to the maximum', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 2;

  await t.notThrowsAsync(
    () => Promise.all([
      semaphore.add(key, 1, maximum),
      semaphore.add(key, 1, maximum),
    ])
  );
});

test('Semaphore.add() cannot increment the semaphore value beyond the maximum', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 1;

  await t.throwsAsync(
    () => Promise.all([
      semaphore.add(key, 1, maximum),
      semaphore.add(key, 1, maximum),
    ]),
    { instanceOf: ResourcesLockedError }
  );
});

test('Semaphore.add() cannot increment the semaphore value when maximum is 0', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 0;

  await t.throwsAsync(
    () => semaphore.add(key, 1, maximum),
    { instanceOf: ResourcesLockedError }
  );
});

test('Semaphore.up() increments the semaphore value', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 1;

  await semaphore.up(key, maximum);
  const response = await semaphore.get(key);
  t.is(response.semvalue, 1);
});

test('Semaphore.down() cannot decrement the semaphore value below 0', async (t) => {
  const { semaphore, key } = t.context;

  const error = await t.throwsAsync(
    () => semaphore.down(key),
    { name: 'ConditionalCheckFailedException' }
  );

  t.false(error instanceof ResourcesLockedError);
});

test('Semaphore.down() decrements the semaphore value', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 1;

  await semaphore.up(key, maximum);
  await semaphore.down(key);
  const response = await semaphore.get(key);
  t.is(response.semvalue, 0);
});

test('Semaphore.up() and Semaphore.down() properly update semaphore value', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 2;

  await semaphore.up(key, maximum);
  await semaphore.down(key);
  await semaphore.up(key, maximum);
  const response = await semaphore.get(key);
  t.is(response.semvalue, 1);
});

test('Semaphore.checkout() properly increments and then decrements semaphore value', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 1;
  const asyncFn = async () => {};

  await semaphore.checkout(key, 1, maximum, asyncFn);

  const response = await semaphore.get(key);
  t.is(response.semvalue, 0);
});

test('Semaphore.checkout() throws error when trying to increment beyond the maximum', async (t) => {
  const { semaphore, key } = t.context;
  const maximum = 1;
  const asyncFn = async () => {};

  await t.throwsAsync(
    () => semaphore.checkout(key, 2, maximum, asyncFn),
    { instanceOf: ResourcesLockedError }
  );
});

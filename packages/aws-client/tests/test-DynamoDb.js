'use strict';

const sinon = require('sinon');
const test = require('ava');
const range = require('lodash/range');
const cryptoRandomString = require('crypto-random-string');

const { RecordDoesNotExist } = require('@cumulus/errors');
const DynamoDb = require('../DynamoDb');
const awsServices = require('../services');

test.before(async () => {
  process.env.tableName = `DynamoDb${cryptoRandomString({ length: 10 })}`;

  await DynamoDb.createAndWaitForDynamoDbTable({
    TableName: process.env.tableName,
    AttributeDefinitions: [
      { AttributeName: 'hash', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'hash', KeyType: 'HASH' },
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5,
    },
  });
});

test.beforeEach((t) => {
  t.timeout(120000);
  t.context.client = awsServices.dynamodbDocClient();
});

test.after.always(
  () => DynamoDb.deleteAndWaitForDynamoDbTableNotExists({ TableName: process.env.tableName })
);

test('DynamoDb.get() returns an existing item', async (t) => {
  const { client } = t.context;
  const hash = `hash${cryptoRandomString({ length: 10 })}`;
  const item = {
    hash,
    foo: 'bar',
  };

  await client.put({
    TableName: process.env.tableName,
    Item: item,
  });

  const response = await DynamoDb.get({
    tableName: process.env.tableName,
    client,
    item: {
      hash,
    },
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
        hash: `hash${cryptoRandomString({ length: 10 })}`,
      },
    }),
    { instanceOf: RecordDoesNotExist }
  );
});

test.serial('DynamoDb.get() throws general error from failure on client.get', async (t) => {
  const { client } = t.context;

  const stub = sinon.stub(client, 'get')
    .throws(new Error('fail'));

  try {
    await t.throwsAsync(
      () => DynamoDb.get({
        tableName: process.env.tableName,
        client,
        item: {
          hash: `hash${cryptoRandomString({ length: 10 })}`,
        },
      }),
      { message: /fail/ }
    );
  } finally {
    stub.restore();
  }
});

test.serial('DynamoDb.scan() properly returns all paginated results', async (t) => {
  const { client } = t.context;

  const items = range(3).map(() => ({
    hash: `hash${cryptoRandomString({ length: 10 })}`,
    foo: 'bar',
  }));
  await Promise.all(items.map(
    (item) => client.put({
      TableName: process.env.tableName,
      Item: item,
    })
  ));
  t.teardown(() => Promise.all(items.map(
    (item) => client.delete({
      TableName: process.env.tableName,
      Key: {
        hash: item.hash,
      },
    })
  )));

  const response = await DynamoDb.scan({
    tableName: process.env.tableName,
    client,
    limit: 2,
  });

  t.is(response.Items.length, 3);
});

test.serial('DynamoDb.parallelScan() properly returns all results', async (t) => {
  const { client } = t.context;

  const items = range(10).map(() => ({
    hash: `hash${cryptoRandomString({ length: 10 })}`,
    foo: 'bar',
  }));
  await Promise.all(items.map(
    (item) => client.put({
      TableName: process.env.tableName,
      Item: item,
    })
  ));
  t.teardown(() => Promise.all(items.map(
    (item) => client.delete({
      TableName: process.env.tableName,
      Key: {
        hash: item.hash,
      },
    })
  )));

  let totalResults = [];
  const testProcessItems = (scanResults) => {
    totalResults = totalResults.concat(scanResults);
    return Promise.resolve(totalResults);
  };

  await DynamoDb.parallelScan({
    totalSegments: 5,
    scanParams: {
      TableName: process.env.tableName,
    },
    processItemsFunc: testProcessItems,
    dynamoDbClient: client,
  });

  t.is(totalResults.length, 10);
});

test.serial('DynamoDb.parallelScan() retries on DynamoDB scan failure', async (t) => {
  const totalSegments = 10;
  let results = [];
  const testProcessItems = (items) => {
    results = results.concat(items);
    return Promise.resolve(results);
  };

  const scanPromiseStub = sinon.stub();
  scanPromiseStub.onCall(0).throws();
  scanPromiseStub.onCall(1).throws();
  scanPromiseStub.resolves({
    Items: [{
      hash: `hash${cryptoRandomString({ length: 10 })}`,
      foo: 'bar',
    }],
  });

  const fakeDynamoClient = {
    scan: scanPromiseStub,
  };

  await DynamoDb.parallelScan({
    totalSegments,
    scanParams: {
      TableName: process.env.tableName,
    },
    processItemsFunc: testProcessItems,
    dynamoDbClient: fakeDynamoClient,
    retryOptions: {
      retries: 3,
    },
  });

  t.is(results.length, totalSegments);
});

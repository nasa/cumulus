const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');
const sortBy = require('lodash/sortBy');
const Knex = require('knex');

const {
  createAndWaitForDynamoDbTable,
  deleteAndWaitForDynamoDbTableNotExists,
} = require('@cumulus/aws-client/DynamoDb');
const { dynamodbDocClient } = require('@cumulus/aws-client/services');

const { migrateCollections } = require('..');

const knex = Knex({
  client: 'pg',
  connection: {
    host: 'localhost',
    user: 'postgres',
    password: 'password',
    database: 'postgres',
  },
});

const generateFakeCollection = (params) => ({
  name: `${cryptoRandomString({ length: 10 })}collection`,
  version: '0.0.0',
  duplicateHandling: 'replace',
  granuleId: '^MOD09GQ\\.A[\\d]{7}\.[\\S]{6}\\.006\\.[\\d]{13}$',
  granuleIdExtraction: '(MOD09GQ\\.(.*))\\.hdf',
  sampleFileName: 'MOD09GQ.A2017025.h21v00.006.2017034065104.hdf',
  files: [{ regex: 'fake-regex ', name: 'file.name' }],
  meta: { foo: 'bar', key: { value: 'test' } },
  reportToEms: false,
  ignoreFilesConfigForDiscovery: false,
  process: 'modis',
  url_path: 'path',
  tags: ['tag1', 'tag2'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...params,
});

const batchWriteItems = (tableName, items) =>
  dynamodbDocClient().batchWrite({
    RequestItems: {
      [tableName]: items.map((item) => ({
        PutRequest: {
          Item: item,
        },
      })),
    },
  }).promise();

const createCollectionDynamoRecords = (items) =>
  batchWriteItems(
    process.env.CollectionsTable,
    items
  );

const destroyCollectionDynamoRecords = (records) =>
  Promise.all(records.map(
    (record) => dynamodbDocClient().delete({
      TableName: process.env.CollectionsTable,
      Key: {
        name: record.name,
        version: record.version,
      },
    }).promise()
  ));

test.before(async () => {
  process.env.CollectionsTable = cryptoRandomString({ length: 10 });

  const collectionsTableHash = { name: 'name', type: 'S' };
  const collectionsTableRange = { name: 'version', type: 'S' };
  await createAndWaitForDynamoDbTable({
    TableName: process.env.CollectionsTable,
    AttributeDefinitions: [{
      AttributeName: collectionsTableHash.name,
      AttributeType: collectionsTableHash.type,
    }, {
      AttributeName: collectionsTableRange.name,
      AttributeType: collectionsTableRange.type,
    }],
    KeySchema: [{
      AttributeName: collectionsTableHash.name,
      KeyType: 'HASH',
    }, {
      AttributeName: collectionsTableRange.name,
      KeyType: 'RANGE',
    }],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5,
    },
  });
});

test.afterEach.always(async () => {
  await knex('collections').truncate();
});

test.after.always(async () => {
  await deleteAndWaitForDynamoDbTableNotExists({
    TableName: process.env.CollectionsTable,
  });
  await knex.destroy();
});

test.serial('migrateCollections handles multiple collections', async (t) => {
  const fakeCollection1 = generateFakeCollection();
  const fakeCollection2 = generateFakeCollection();

  await createCollectionDynamoRecords([
    fakeCollection1,
    fakeCollection2,
  ]);
  t.teardown(() => destroyCollectionDynamoRecords([
    fakeCollection1,
    fakeCollection2,
  ]));

  await migrateCollections(process.env, knex);

  const records = await knex().select().table('collections');

  t.deepEqual(
    sortBy([
      omit(records[0], ['cumulusId', 'created_at', 'updated_at']),
      omit(records[1], ['cumulusId', 'created_at', 'updated_at']),
    ], 'name'),
    sortBy([
      omit({
        ...fakeCollection1,
        granuleIdValidationRegex: fakeCollection1.granuleId,
      }, ['granuleId', 'createdAt', 'updatedAt']),
      omit({
        ...fakeCollection2,
        granuleIdValidationRegex: fakeCollection2.granuleId,
      }, ['granuleId', 'createdAt', 'updatedAt']),
    ], 'name')
  );
});

test.serial('migrateCollections processes all non-failing records', async (t) => {
  const fakeCollection1 = generateFakeCollection();
  const fakeCollection2 = generateFakeCollection();
  // change timestamp to string so that record will fail
  fakeCollection2.createdAt = 'bad-value';

  await createCollectionDynamoRecords([
    fakeCollection1,
    fakeCollection2,
  ]);
  t.teardown(() => destroyCollectionDynamoRecords([
    fakeCollection1,
    fakeCollection2,
  ]));

  const createdRecordIds = await migrateCollections(process.env, knex);
  t.is(createdRecordIds.length, 1);
});

test.todo('handles nullable fields');
test.todo('ignores extraneous fields');
test.todo('JSONB fields are in expected state');

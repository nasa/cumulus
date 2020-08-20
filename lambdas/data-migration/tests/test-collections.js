const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');
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
  files: [{ regex: 'fake-regex ', sampleFileName: 'file.name', bucket: 'bucket' }],
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

test.serial('migrateCollections correctly migrates collection record', async (t) => {
  const fakeCollection = generateFakeCollection();

  await createCollectionDynamoRecords([
    fakeCollection,
  ]);
  t.teardown(() => destroyCollectionDynamoRecords([
    fakeCollection,
  ]));

  await migrateCollections(process.env, knex);

  const records = await knex().select().table('collections');

  t.deepEqual(
    omit(records[0], ['cumulusId']),
    omit(
      {
        ...fakeCollection,
        granuleIdValidationRegex: fakeCollection.granuleId,
        created_at: new Date(fakeCollection.createdAt),
        updated_at: new Date(fakeCollection.updatedAt),
      },
      ['granuleId', 'createdAt', 'updatedAt']
    )
  );
});

test.serial('migrateCollections processes multiple collections', async (t) => {
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
  t.is(records.length, 2);
});

test.serial('migrateCollections does not process invalid source data from Dynamo', async (t) => {
  const fakeCollection = generateFakeCollection();

  // make source record invalid
  delete fakeCollection.files;

  await createCollectionDynamoRecords([
    fakeCollection,
  ]);
  t.teardown(() => destroyCollectionDynamoRecords([
    fakeCollection,
  ]));

  const createdRecordIds = await migrateCollections(process.env, knex);
  t.is(createdRecordIds.length, 0);
});

test.serial('migrateCollections processes all non-failing records', async (t) => {
  const fakeCollection1 = generateFakeCollection();
  const fakeCollection2 = generateFakeCollection();

  // remove required source field so that record will fail
  delete fakeCollection1.sampleFileName;

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

test.serial('migrateCollections handles nullable fields on source collection data', async (t) => {
  const fakeCollection = generateFakeCollection();

  // remove nullable fields
  delete fakeCollection.dataType;
  delete fakeCollection.url_path;
  delete fakeCollection.duplicateHandling;
  delete fakeCollection.process;
  delete fakeCollection.reportToEms;
  delete fakeCollection.ignoreFilesConfigForDiscovery;
  delete fakeCollection.meta;
  delete fakeCollection.tags;

  await createCollectionDynamoRecords([
    fakeCollection,
  ]);
  t.teardown(() => destroyCollectionDynamoRecords([
    fakeCollection,
  ]));

  const createdRecordIds = await migrateCollections(process.env, knex);
  t.is(createdRecordIds.length, 1);

  const records = await knex().select().table('collections');
  t.deepEqual(
    omit(records[0], ['cumulusId']),
    omit(
      {
        ...fakeCollection,
        granuleIdValidationRegex: fakeCollection.granuleId,
        url_path: null,
        process: null,
        ignoreFilesConfigForDiscovery: null,
        meta: null,
        tags: null,
        created_at: new Date(fakeCollection.createdAt),
        updated_at: new Date(fakeCollection.updatedAt),
        // schema validation will add default values
        duplicateHandling: 'error',
        reportToEms: true,
      },
      ['granuleId', 'createdAt', 'updatedAt']
    )
  );
});

test.serial('migrateCollections ignores extraneous fields from Dynamo', async (t) => {
  const fakeCollection = generateFakeCollection();

  // add extraneous fields from Dynamo that will not exist in RDS
  fakeCollection.dataType = 'data-type';

  await createCollectionDynamoRecords([
    fakeCollection,
  ]);
  t.teardown(() => destroyCollectionDynamoRecords([
    fakeCollection,
  ]));

  await t.notThrowsAsync(migrateCollections(process.env, knex));
});

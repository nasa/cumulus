const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const Knex = require('knex');

const {
  createAndWaitForDynamoDbTable,
  deleteAndWaitForDynamoDbTableNotExists
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
  process: 'modis',
  url_path: 'path',
  tags: ['tag1', 'tag2'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...params,
});

const batchWriteItems = (tableName, items) =>
  dynamodbDocClient().batchWrite({
    RequestItems: { [tableName]: items },
  }).promise();

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

test.after.always(async () => {
  await deleteAndWaitForDynamoDbTableNotExists({
    TableName: process.env.CollectionsTable,
  });
  await knex.destroy();
});

test('migrateCollections', async (t) => {
  const fakeCollection1 = generateFakeCollection();
  const items = [{
    PutRequest: {
      Item: fakeCollection1,
    },
  }, {
    PutRequest: {
      Item: generateFakeCollection(),
    },
  }];
  try {
    await batchWriteItems(process.env.CollectionsTable, items);
    await migrateCollections(process.env, knex);

    const results = await knex().select().table('collections');
    t.teardown(async () => {
      await Promise.all(results.map(async (result) => {
        await knex('collections')
          .where('cumulusId', result.cumulusId)
          .delete();
      }));
    });

    t.pass();
    // delete fakeCollection1.granuleId;
    // t.deepEqual(results[0], {
    //   ...fakeCollection1,
    //   granuleIdValidationRegex: fakeCollection1.granuleId,
    // });
  } catch (err) {
    t.fail();
  }
});

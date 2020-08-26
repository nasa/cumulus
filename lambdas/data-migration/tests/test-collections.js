const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');
const Knex = require('knex');

const Collection = require('@cumulus/api/models/collections');
const Rule = require('@cumulus/api/models/rules');
const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');

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
  files: [{ regex: '^.*\\.txt$', sampleFileName: 'file.txt', bucket: 'bucket' }],
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

let collectionsModel;
let rulesModel;

test.before(async () => {
  process.env.stackName = cryptoRandomString({ length: 10 });
  process.env.system_bucket = cryptoRandomString({ length: 10 });
  process.env.CollectionsTable = cryptoRandomString({ length: 10 });
  process.env.RulesTable = cryptoRandomString({ length: 10 });

  await createBucket(process.env.system_bucket);

  collectionsModel = new Collection();
  await collectionsModel.createTable();

  rulesModel = new Rule();
  await rulesModel.createTable();
});

test.afterEach.always(async () => {
  await knex('collections').truncate();
});

test.after.always(async () => {
  await collectionsModel.deleteTable();
  await rulesModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await knex.destroy();
});

test.serial('migrateCollections correctly migrates collection record', async (t) => {
  const fakeCollection = generateFakeCollection();

  const createdRecord = await collectionsModel.create(fakeCollection);
  t.teardown(() => collectionsModel.delete(fakeCollection));

  await migrateCollections(process.env, knex);

  const records = await knex().select().table('collections');

  t.deepEqual(
    omit(records[0], ['cumulusId']),
    omit(
      {
        ...createdRecord,
        granuleIdValidationRegex: createdRecord.granuleId,
        created_at: new Date(createdRecord.createdAt),
        updated_at: new Date(createdRecord.updatedAt),
      },
      ['granuleId', 'createdAt', 'updatedAt']
    )
  );
});

test.serial('migrateCollections processes multiple collections', async (t) => {
  const fakeCollection1 = generateFakeCollection();
  const fakeCollection2 = generateFakeCollection();

  await Promise.all([
    collectionsModel.create(fakeCollection1),
    collectionsModel.create(fakeCollection2),
  ]);
  t.teardown(() => Promise.all([
    collectionsModel.delete(fakeCollection1),
    collectionsModel.delete(fakeCollection2),
  ]));

  await migrateCollections(process.env, knex);

  const records = await knex().select().table('collections');
  t.is(records.length, 2);
});

test.serial('migrateCollections does not process invalid source data from Dynamo', async (t) => {
  const fakeCollection = generateFakeCollection();

  // make source record invalid
  delete fakeCollection.files;

  // Have to use Dynamo client directly because creating
  // via model won't allow creation of an invalid record
  await dynamodbDocClient().put({
    TableName: process.env.CollectionsTable,
    Item: fakeCollection,
  });

  t.teardown(() => collectionsModel.delete(fakeCollection));

  const createdRecordIds = await migrateCollections(process.env, knex);
  t.is(createdRecordIds.length, 0);
});

test.serial('migrateCollections processes all non-failing records', async (t) => {
  const fakeCollection1 = generateFakeCollection();
  const fakeCollection2 = generateFakeCollection();

  // remove required source field so that record will fail
  delete fakeCollection1.sampleFileName;

  await Promise.all([
    // Have to use Dynamo client directly because creating
    // via model won't allow creation of an invalid record
    dynamodbDocClient().put({
      TableName: process.env.CollectionsTable,
      Item: fakeCollection1,
    }),
    collectionsModel.create(fakeCollection2),
  ]);
  t.teardown(() => Promise.all([
    collectionsModel.delete(fakeCollection1),
    collectionsModel.delete(fakeCollection2),
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

  const createdRecord = await collectionsModel.create(fakeCollection);
  t.teardown(() => collectionsModel.delete(fakeCollection));

  const createdRecordIds = await migrateCollections(process.env, knex);
  t.is(createdRecordIds.length, 1);

  const records = await knex().select().table('collections');
  t.deepEqual(
    omit(records[0], ['cumulusId']),
    omit(
      {
        ...createdRecord,
        granuleIdValidationRegex: createdRecord.granuleId,
        url_path: null,
        process: null,
        ignoreFilesConfigForDiscovery: null,
        meta: null,
        tags: null,
        created_at: new Date(createdRecord.createdAt),
        updated_at: new Date(createdRecord.updatedAt),
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

  await collectionsModel.create(fakeCollection);
  t.teardown(() => collectionsModel.delete(fakeCollection));

  await t.notThrowsAsync(migrateCollections(process.env, knex));
});

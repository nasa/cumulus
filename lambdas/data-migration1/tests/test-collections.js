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

const {
  RecordAlreadyMigrated,
  migrateCollectionRecord,
  migrateCollections,
} = require('..');

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

test.serial('migrateCollectionRecord correctly migrates collection record', async (t) => {
  const fakeCollection = generateFakeCollection();

  const cumulusId = await migrateCollectionRecord(fakeCollection, knex);
  const [createdRecord] = await knex.queryBuilder()
    .select()
    .table('collections')
    .where('cumulusId', cumulusId);

  t.deepEqual(
    omit(createdRecord, ['cumulusId']),
    omit(
      {
        ...fakeCollection,
        granuleIdValidationRegex: fakeCollection.granuleId,
        granuleIdExtractionRegex: fakeCollection.granuleIdExtraction,
        created_at: new Date(fakeCollection.createdAt),
        updated_at: new Date(fakeCollection.updatedAt),
      },
      ['granuleId', 'granuleIdExtraction', 'createdAt', 'updatedAt']
    )
  );
});

test.serial('migrateCollectionRecord throws error on invalid source data from Dynamo', async (t) => {
  const fakeCollection = generateFakeCollection();

  // make source record invalid
  delete fakeCollection.files;

  await t.throwsAsync(migrateCollectionRecord(fakeCollection, knex));
});

test.serial('migrateCollectionRecord handles nullable fields on source collection data', async (t) => {
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

  const cumulusId = await migrateCollectionRecord(fakeCollection, knex);
  const [createdRecord] = await knex.queryBuilder()
    .select()
    .table('collections')
    .where('cumulusId', cumulusId);

  t.deepEqual(
    omit(createdRecord, ['cumulusId']),
    omit(
      {
        ...fakeCollection,
        granuleIdValidationRegex: fakeCollection.granuleId,
        granuleIdExtractionRegex: fakeCollection.granuleIdExtraction,
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
      ['granuleId', 'granuleIdExtraction', 'createdAt', 'updatedAt']
    )
  );
});

test.serial('migrateCollectionRecord ignores extraneous fields from Dynamo', async (t) => {
  const fakeCollection = generateFakeCollection();

  // add extraneous fields from Dynamo that will not exist in RDS
  fakeCollection.dataType = 'data-type';

  await t.notThrowsAsync(migrateCollectionRecord(fakeCollection, knex));
});

test.serial('migrateCollectionRecord throws RecordAlreadyMigrated error for already migrated record', async (t) => {
  const fakeCollection = generateFakeCollection();

  await migrateCollectionRecord(fakeCollection, knex);
  await t.throwsAsync(
    migrateCollectionRecord(fakeCollection, knex),
    { instanceOf: RecordAlreadyMigrated }
  );
});

test.serial('migrateCollections skips already migrated record', async (t) => {
  const fakeCollection = generateFakeCollection();

  await migrateCollectionRecord(fakeCollection, knex);
  await collectionsModel.create(fakeCollection);
  t.teardown(() => collectionsModel.delete(fakeCollection));
  const migrationSummary = await migrateCollections(process.env, knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 1,
    skipped: 1,
    failed: 0,
    success: 0,
  });
  const records = await knex.queryBuilder().select().table('collections');
  t.is(records.length, 1);
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

  const migrationSummary = await migrateCollections(process.env, knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 2,
    skipped: 0,
    failed: 0,
    success: 2,
  });
  const records = await knex.queryBuilder().select().table('collections');
  t.is(records.length, 2);
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
    }).promise(),
    collectionsModel.create(fakeCollection2),
  ]);
  t.teardown(() => Promise.all([
    collectionsModel.delete(fakeCollection1),
    collectionsModel.delete(fakeCollection2),
  ]));

  const migrationSummary = await migrateCollections(process.env, knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 2,
    skipped: 0,
    failed: 1,
    success: 1,
  });
  const records = await knex.queryBuilder().select().table('collections');
  t.is(records.length, 1);
});

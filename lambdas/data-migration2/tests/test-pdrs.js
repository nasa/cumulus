const test = require('ava');
const omit = require('lodash/omit');
const cryptoRandomString = require('crypto-random-string');

const {
  translateApiCollectionToPostgresCollection,
  translateApiProviderToPostgresProvider,
  tableNames,
} = require('@cumulus/db');

const Collection = require('@cumulus/api/models/collections');
const Provider = require('@cumulus/api/models/providers');
const Execution = require('@cumulus/api/models/executions');
const Pdr = require('@cumulus/api/models/pdrs');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { getKnexClient, localStackConnectionEnv } = require('@cumulus/db');
const { fakeCollectionFactory, fakeProviderFactory } = require('@cumulus/api/lib/testUtils');

// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../db-migration');
const { migratePdrRecord, migratePdrs } = require('../dist/lambda/pdrs');
const { RecordAlreadyMigrated } = require('../dist/lambda/errors');

const migrateFakeCollectionRecord = async (record, knex) => {
  const updatedRecord = translateApiCollectionToPostgresCollection(record);
  const [id] = await knex(tableNames.collections).insert(updatedRecord).returning('cumulus_id');
  return id;
};

const fakeEncryptFunction = async () => 'fakeEncryptedString';

const migrateFakeProviderRecord = async (record, knex) => {
  const updatedRecord = await translateApiProviderToPostgresProvider(record, fakeEncryptFunction);
  const [id] = await knex(tableNames.providers).insert(updatedRecord).returning('cumulus_id');
  return id;
};

const generateTestPdr = (collectionId, provider, executionId) => ({
  pdrName: cryptoRandomString({ length: 5 }),
  collectionId: collectionId,
  provider: provider,
  status: 'running',
  progress: 10,
  execution: executionId,
  PANSent: false,
  stats: { total: 1, completed: 0, failed: 0, processing: 1 },
  address: cryptoRandomString({ length: 5 }),
  originalUrl: cryptoRandomString({ length: 5 }),
  timestamp: Date.now(),
  duration: 10,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

let collectionsModel;
let providersModel;
let executionsModel;
let pdrsModel;

const testDbName = `data_migration_2_${cryptoRandomString({ length: 10 })}`;
const testDbUser = 'postgres';

test.before(async (t) => {
  process.env.stackName = cryptoRandomString({ length: 10 });
  process.env.system_bucket = cryptoRandomString({ length: 10 });

  process.env.CollectionsTable = cryptoRandomString({ length: 10 });
  process.env.ProvidersTable = cryptoRandomString({ length: 10 });
  process.env.ExecutionsTable = cryptoRandomString({ length: 10 });
  process.env.PdrsTable = cryptoRandomString({ length: 10 });

  await createBucket(process.env.system_bucket);

  collectionsModel = new Collection();
  await collectionsModel.createTable();

  providersModel = new Provider();
  await providersModel.createTable();

  executionsModel = new Execution();
  await executionsModel.createTable();

  pdrsModel = new Pdr();
  await pdrsModel.createTable();

  t.context.knexAdmin = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      migrationDir,
    },
  });
  await t.context.knexAdmin.raw(`create database "${testDbName}";`);
  await t.context.knexAdmin.raw(`grant all privileges on database "${testDbName}" to "${testDbUser}"`);

  t.context.knex = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      PG_DATABASE: testDbName,
      migrationDir,
    },
  });

  await t.context.knex.migrate.latest();
});

test.beforeEach(async (t) => {
  const testCollection = fakeCollectionFactory();
  const testProvider = fakeProviderFactory({
    encrypted: true,
    privateKey: 'key',
    cmKeyId: 'key-id',
    certificateUri: 'uri',
  });

  t.context.testCollection = testCollection;
  t.context.testProvider = testProvider;

  t.context.collectionCumulusId = await migrateFakeCollectionRecord(testCollection, t.context.knex);
  t.context.providerCumulusId = await migrateFakeProviderRecord(testProvider, t.context.knex);
});

test.afterEach.always(async (t) => {
  await t.context.knex(tableNames.pdrs).del();
  await t.context.knex(tableNames.providers).del();
  await t.context.knex(tableNames.collections).del();
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);

  await providersModel.deleteTable();
  await collectionsModel.deleteTable();
  await executionsModel.deleteTable();
  await pdrsModel.deleteTable();

  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${testDbName}"`);
  await t.context.knexAdmin.destroy();
});

test.serial('migratePdrRecord correctly migrates PDR record', async (t) => {
  const { knex, testCollection, testProvider, collectionCumulusId, providerCumulusId } = t.context;

  const testPdr = generateTestPdr(testCollection.name, testProvider.id);
  await migratePdrRecord(testPdr, knex);

  const record = await t.context.knex.queryBuilder()
    .select()
    .table(tableNames.pdrs)
    .where({ name: testPdr.pdrName })
    .first();

  t.like(
    omit(record, ['cumulus_id']),
    omit({
      name: testPdr.pdrName,
      provider_cumulus_id: providerCumulusId,
      collection_cumulus_id: collectionCumulusId,
      execution_cumulus_id: testPdr.executionCumulusId ? testPdr.executionCumulusId : null,
      status: testPdr.status,
      progress: testPdr.progress,
      pan_sent: testPdr.PANSent,
      stats: testPdr.stats,
      address: testPdr.address,
      original_url: testPdr.originalUrl,
      timestamp: new Date(testPdr.timestamp),
      duration: testPdr.duration,
      created_at: new Date(testPdr.createdAt),
      updated_at: new Date(testPdr.updatedAt),
    },
    ['updated_at'])
  );
});

test.serial('migratePdrRecord throws SchemaValidationError on invalid source data from DynamoDB', async (t) => {
  const { knex, testCollection, testProvider } = t.context;

  const testPdr = generateTestPdr(testCollection.name, testProvider.id);

  delete testPdr.status;

  await t.throwsAsync(
    migratePdrRecord(testPdr, knex),
    { name: 'SchemaValidationError' }
  );
});

test.serial('migratePdrRecord handles nullable fields on source PDR data', async (t) => {
  const { knex, testCollection, testProvider, collectionCumulusId, providerCumulusId } = t.context;

  const testPdr = generateTestPdr(testCollection.name, testProvider.id);

  delete testPdr.execution;
  delete testPdr.PANSent;
  delete testPdr.PANmessage;
  delete testPdr.progress;
  delete testPdr.stats;
  delete testPdr.address;
  delete testPdr.originalUrl;
  delete testPdr.timestamp;
  delete testPdr.duration;
  delete testPdr.updatedAt;

  await migratePdrRecord(testPdr, knex);
  const record = await t.context.knex.queryBuilder()
    .select()
    .table(tableNames.pdrs)
    .where({ name: testPdr.pdrName })
    .first();

  t.like(
    omit(record, ['cumulus_id']),
    omit({
      ...testPdr,
      name: testPdr.pdrName,
      provider_cumulus_id: providerCumulusId,
      collection_cumulus_id: collectionCumulusId,
      execution_cumulus_id: testPdr.executionCumulusId ? testPdr.executionCumulusId : null,
      status: testPdr.status,
      progress: null,
      pan_sent: null,
      stats: null,
      address: null,
      original_url: null,
      timestamp: null,
      duration: null,
      created_at: new Date(testPdr.createdAt),
      updated_at: new Date(testPdr.updatedAt),
    }, ['createdAt', 'updatedAt', 'pdrName', 'collection', 'provider', 'collectionId', 'updated_at'])
  );
});

test.serial('migratePdrRecord throws RecordAlreadyMigrated error for already migrated record', async (t) => {
  const { knex, testCollection, testProvider } = t.context;

  const testPdr = generateTestPdr(testCollection.name, testProvider.id);
  await migratePdrRecord(testPdr, knex);

  await t.throwsAsync(
    migratePdrRecord(testPdr, knex),
    { instanceOf: RecordAlreadyMigrated }
  );
});

test.serial.skip('migratePdrs skips already migrated record', async (t) => {
  const { knex, testCollection, testProvider } = t.context;
  const testPdr = generateTestPdr(testCollection.name, testProvider.id);

  await migratePdrRecord(testPdr, knex);
  await pdrsModel.create(testPdr);

  t.teardown(() => pdrsModel.delete(testPdr));
  const migrationSummary = await migratePdrs(process.env, knex);

  t.deepEqual(migrationSummary, {
    dynamoRecords: 1,
    skipped: 1,
    failed: 0,
    success: 0,
  });
  const records = await t.context.knex.queryBuilder().select().table(tableNames.pdrs);
  t.is(records.length, 1);
});

test.serial.skip('migratePdrs processes multiple PDR records', async (t) => {
  const { knex, testCollection, testProvider } = t.context;
  const anotherCollection = fakeCollectionFactory();
  const anotherProvider = fakeProviderFactory({
    encrypted: true,
    privateKey: 'key',
    cmKeyId: 'key-id',
    certificateUri: 'uri',
  });

  const testPdr = generateTestPdr(testCollection.name, testProvider.id);
  const anotherPdr = generateTestPdr(anotherCollection.name, anotherProvider.id);
  await migrateFakeCollectionRecord(anotherCollection, t.context.knex);
  await migrateFakeProviderRecord(anotherProvider, t.context.knex);

  await Promise.all([
    pdrsModel.create(testPdr),
    pdrsModel.create(anotherPdr),
  ]);
  t.teardown(() => Promise.all([
    pdrsModel.delete(testPdr),
    pdrsModel.delete(anotherPdr),
  ]));
  const migrationSummary = await migratePdrs(process.env, knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 2,
    skipped: 0,
    failed: 0,
    success: 2,
  });
  const records = await t.context.knex.queryBuilder().select().table(tableNames.pdrs);
  t.is(records.length, 2);
});

test.serial.skip('migratePdrs processes all non-failing records', async (t) => {
  const { knex, testCollection, testProvider } = t.context;
  const anotherCollection = fakeCollectionFactory();
  const anotherProvider = fakeProviderFactory({
    encrypted: true,
    privateKey: 'key',
    cmKeyId: 'key-id',
    certificateUri: 'uri',
  });

  const testPdr = generateTestPdr(testCollection.name, testProvider.id);
  const anotherPdr = generateTestPdr(anotherCollection.name, anotherProvider.id);
  await migrateFakeCollectionRecord(anotherCollection, t.context.knex);
  await migrateFakeProviderRecord(anotherProvider, t.context.knex);

  await Promise.all([
    pdrsModel.create(testPdr),
    pdrsModel.create(anotherPdr),
  ]);
  t.teardown(() => Promise.all([
    pdrsModel.delete(testPdr),
    pdrsModel.delete(anotherPdr),
  ]));
  const migrationSummary = await migratePdrs(process.env, knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 2,
    skipped: 0,
    failed: 1,
    success: 1,
  });
  const records = await t.context.knex.queryBuilder().select().table(tableNames.pdrs);
  t.is(records.length, 1);
});

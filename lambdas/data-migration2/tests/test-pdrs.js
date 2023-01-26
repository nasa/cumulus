const cryptoRandomString = require('crypto-random-string');
const test = require('ava');
const sinon = require('sinon');

const Collection = require('@cumulus/api/models/collections');
const Provider = require('@cumulus/api/models/providers');
const Pdr = require('@cumulus/api/models/pdrs');
const { constructCollectionId } = require('@cumulus/message/Collections');
const Logger = require('@cumulus/logger');

const {
  CollectionPgModel,
  ExecutionPgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeProviderRecordFactory,
  generateLocalTestDb,
  destroyLocalTestDb,
  PdrPgModel,
  ProviderPgModel,
  TableNames,
  migrationDir,
} = require('@cumulus/db');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const { RecordAlreadyMigrated, PostgresUpdateFailed } = require('@cumulus/errors');

const { migratePdrRecord, migratePdrs } = require('../dist/lambda/pdrs');

const generateTestPdr = (params) => ({
  pdrName: cryptoRandomString({ length: 5 }),
  status: 'running',
  progress: 10,
  PANSent: false,
  PANmessage: 'message',
  stats: { total: 1, completed: 0, failed: 0, processing: 1 },
  address: cryptoRandomString({ length: 5 }),
  originalUrl: cryptoRandomString({ length: 5 }),
  timestamp: Date.now(),
  duration: 10,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...params,
});

let collectionsModel;
let providersModel;
let pdrsModel;

const testDbName = `data_migration_2_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  process.env.stackName = cryptoRandomString({ length: 10 });
  process.env.system_bucket = cryptoRandomString({ length: 10 });

  process.env.CollectionsTable = cryptoRandomString({ length: 10 });
  process.env.ProvidersTable = cryptoRandomString({ length: 10 });
  process.env.PdrsTable = cryptoRandomString({ length: 10 });

  await createBucket(process.env.system_bucket);

  collectionsModel = new Collection();
  await collectionsModel.createTable();

  providersModel = new Provider();
  await providersModel.createTable();

  pdrsModel = new Pdr();
  await pdrsModel.createTable();

  t.context.pdrPgModel = new PdrPgModel();

  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;
});

test.beforeEach(async (t) => {
  const collectionPgModel = new CollectionPgModel();
  t.context.testCollection = fakeCollectionRecordFactory();

  const collectionResponse = await collectionPgModel.create(
    t.context.knex,
    t.context.testCollection
  );
  t.context.collectionCumulusId = collectionResponse[0].cumulus_id;

  const providerPgModel = new ProviderPgModel();
  t.context.testProvider = fakeProviderRecordFactory();

  const providerResponse = await providerPgModel.create(
    t.context.knex,
    t.context.testProvider
  );
  t.context.providerCumulusId = providerResponse[0].cumulus_id;
});

test.afterEach.always(async (t) => {
  await t.context.knex(TableNames.pdrs).del();
  await t.context.knex(TableNames.providers).del();
  await t.context.knex(TableNames.collections).del();
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);

  await providersModel.deleteTable();
  await collectionsModel.deleteTable();
  await pdrsModel.deleteTable();

  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test.serial('migratePdrRecord correctly migrates PDR record', async (t) => {
  const {
    collectionCumulusId,
    knex,
    pdrPgModel,
    providerCumulusId,
    testCollection,
    testProvider,
  } = t.context;
  const executionPgModel = new ExecutionPgModel();
  const execution = fakeExecutionRecordFactory();

  const [executionResponse] = await executionPgModel.create(
    knex,
    execution
  );
  const executionCumulusId = executionResponse.cumulus_id;

  const testPdr = generateTestPdr({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    provider: testProvider.name,
    execution: execution.url,
  });
  await migratePdrRecord(testPdr, knex);

  const record = await pdrPgModel.get(knex, { name: testPdr.pdrName });

  t.like(
    record,
    {
      name: testPdr.pdrName,
      provider_cumulus_id: providerCumulusId,
      collection_cumulus_id: collectionCumulusId,
      execution_cumulus_id: executionCumulusId,
      status: testPdr.status,
      progress: testPdr.progress,
      pan_sent: testPdr.PANSent,
      pan_message: testPdr.PANmessage,
      stats: testPdr.stats,
      address: testPdr.address,
      original_url: testPdr.originalUrl,
      timestamp: new Date(testPdr.timestamp),
      duration: testPdr.duration,
      created_at: new Date(testPdr.createdAt),
      updated_at: new Date(testPdr.updatedAt),
    }
  );
});

test.serial('migratePdrRecord handles nullable fields on source PDR data', async (t) => {
  const {
    collectionCumulusId,
    knex,
    pdrPgModel,
    providerCumulusId,
    testCollection,
    testProvider,
  } = t.context;

  const testPdr = generateTestPdr({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    provider: testProvider.name,
  });

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
  const record = await pdrPgModel.get(knex, { name: testPdr.pdrName });

  t.like(
    record,
    {
      name: testPdr.pdrName,
      provider_cumulus_id: providerCumulusId,
      collection_cumulus_id: collectionCumulusId,
      execution_cumulus_id: null,
      status: testPdr.status,
      progress: null,
      pan_sent: null,
      pan_message: null,
      stats: null,
      address: null,
      original_url: null,
      timestamp: null,
      duration: null,
      created_at: new Date(testPdr.createdAt),
    }
  );
});

test.serial('migratePdrRecord throws RecordAlreadyMigrated error if previously migrated record is newer', async (t) => {
  const { knex, testCollection, testProvider } = t.context;

  const testPdr = generateTestPdr({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    provider: testProvider.name,
  });
  await migratePdrRecord(testPdr, knex);

  const olderTestPdr = {
    ...testPdr,
    updatedAt: Date.now() - 1000,
  };

  await t.throwsAsync(
    migratePdrRecord(olderTestPdr, knex),
    { instanceOf: RecordAlreadyMigrated }
  );
});

test.serial('migratePdrRecord throws error if upsert does not return any rows', async (t) => {
  const { knex, testCollection, testProvider } = t.context;

  // Create a PDR in the "running" status.
  const testPdr = generateTestPdr({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    provider: testProvider.name,
    status: 'running',
  });

  await migratePdrRecord(testPdr, knex);

  // An upsert of a PDR in the "running" state may return 0 rows if the upsert
  // conditions are not met. In this case the migration of this record will fail.
  const newerTestPdr = {
    ...testPdr,
    updatedAt: Date.now(),
  };

  await t.throwsAsync(
    migratePdrRecord(newerTestPdr, knex),
    { instanceOf: PostgresUpdateFailed }
  );
});

test.serial('migratePdrRecord updates an already migrated record if the updated date is newer', async (t) => {
  const {
    knex,
    testCollection,
    testProvider,
    pdrPgModel,
  } = t.context;

  const executionPgModel = new ExecutionPgModel();
  const execution = fakeExecutionRecordFactory();

  await executionPgModel.create(
    knex,
    execution
  );

  const testPdr = generateTestPdr({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    provider: testProvider.name,
    execution: execution.url,
    status: 'completed',
    updatedAt: Date.now() - 1000,
  });
  await migratePdrRecord(testPdr, knex);

  const newerTestPdr = {
    ...testPdr,
    updatedAt: Date.now(),
  };

  await migratePdrRecord(newerTestPdr, knex);

  const createdRecord = await pdrPgModel.get(knex, { name: testPdr.pdrName });

  t.deepEqual(createdRecord.updated_at, new Date(newerTestPdr.updatedAt));
});

test.serial('migratePdrs skips already migrated record', async (t) => {
  const {
    knex,
    testCollection,
    testProvider,
  } = t.context;
  const testPdr = generateTestPdr({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    provider: testProvider.name,
  });

  await migratePdrRecord(testPdr, knex);
  await pdrsModel.create(testPdr);

  const migrationSummary = await migratePdrs(process.env, knex);
  t.deepEqual(migrationSummary,
    {
      total_dynamo_db_records: 1,
      skipped: 1,
      failed: 0,
      migrated: 0,
    });

  const records = await knex(TableNames.pdrs).where({ name: testPdr.pdrName });
  t.is(records.length, 1);
  t.teardown(() => pdrsModel.delete({ pdrName: testPdr.pdrName }));
});

test.serial('migratePdrs processes multiple PDR records', async (t) => {
  const {
    knex,
    testCollection,
    testProvider,
  } = t.context;

  const testPdr = generateTestPdr({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    provider: testProvider.name,
  });
  const anotherPdr = generateTestPdr({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    provider: testProvider.name,
  });

  await Promise.all([
    pdrsModel.create(testPdr),
    pdrsModel.create(anotherPdr),
  ]);
  t.teardown(() => Promise.all([
    pdrsModel.delete({ pdrName: testPdr.pdrName }),
    pdrsModel.delete({ pdrName: anotherPdr.pdrName }),
  ]));
  const migrationSummary = await migratePdrs(process.env, knex);
  t.deepEqual(migrationSummary, {
    total_dynamo_db_records: 2,
    skipped: 0,
    failed: 0,
    migrated: 2,
  });
  const records = await knex(TableNames.pdrs);
  t.is(records.length, 2);
});

test.serial('migratePdrs processes all non-failing records', async (t) => {
  const {
    knex,
    testCollection,
    testProvider,
  } = t.context;

  const testPdr = generateTestPdr({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    provider: testProvider.name,
  });
  const anotherPdr = generateTestPdr({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    provider: testProvider.name,
  });
  delete testPdr.status;

  await Promise.all([
    // Have to use Dynamo client directly because creating
    // via model won't allow creation of an invalid record
    dynamodbDocClient().put({
      TableName: process.env.PdrsTable,
      Item: testPdr,
    }),
    pdrsModel.create(anotherPdr),
  ]);
  t.teardown(() => Promise.all([
    pdrsModel.delete({ pdrName: testPdr.pdrName }),
    pdrsModel.delete({ pdrName: anotherPdr.pdrName }),
  ]));
  const migrationSummary = await migratePdrs(process.env, knex);
  t.deepEqual(migrationSummary, {
    total_dynamo_db_records: 2,
    skipped: 0,
    failed: 1,
    migrated: 1,
  });
  const records = await knex(TableNames.pdrs);
  t.is(records.length, 1);
});

test.serial('migratePdrs logs summary of migration every for a specified interval', async (t) => {
  const logSpy = sinon.spy(Logger.prototype, 'info');
  const {
    knex,
    testCollection,
    testProvider,
  } = t.context;

  const testPdr = generateTestPdr({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    provider: testProvider.name,
  });

  await pdrsModel.create(testPdr);

  t.teardown(async () => {
    logSpy.restore();
    await pdrsModel.delete({ pdrName: testPdr.pdrName });
  });

  await migratePdrs(
    process.env,
    knex,
    {
      loggingInterval: 1,
    }
  );
  t.true(logSpy.calledWith('Batch of 1 PDR records processed, 1 total'));
});

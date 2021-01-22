const test = require('ava');
const omit = require('lodash/omit');
const cryptoRandomString = require('crypto-random-string');

const Collection = require('@cumulus/api/models/collections');
const Provider = require('@cumulus/api/models/providers');
const Pdr = require('@cumulus/api/models/pdrs');

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
  tableNames,
} = require('@cumulus/db');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const { RecordAlreadyMigrated } = require('@cumulus/errors');

// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../db-migration');
const { migratePdrRecord, migratePdrs } = require('../dist/lambda/pdrs');

const generateTestPdr = (collection, provider, executionArn) => ({
  pdrName: cryptoRandomString({ length: 5 }),
  collectionId: `${collection.name}___${collection.version}`,
  provider: provider,
  status: 'running',
  progress: 10,
  execution: executionArn,
  PANSent: false,
  PANmessage: 'message',
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
  t.context.collectionCumulusId = collectionResponse[0];
  t.context.collectionPgModel = collectionPgModel;

  const providerPgModel = new ProviderPgModel();
  t.context.testProvider = fakeProviderRecordFactory();

  const providerResponse = await providerPgModel.create(
    t.context.knex,
    t.context.testProvider
  );
  t.context.providerCumulusId = providerResponse[0];
  t.context.providerPgModel = providerPgModel;
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

  const executionResponse = await executionPgModel.create(
    knex,
    execution
  );
  const executionCumulusId = executionResponse[0];

  const testPdr = generateTestPdr(testCollection, testProvider.name, execution.arn);
  await migratePdrRecord(testPdr, knex);

  const record = await pdrPgModel.get(knex, { name: testPdr.pdrName });

  t.like(
    record,
    omit({
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
    },
    ['updated_at'])
  );
});

test.serial('migratePdrRecord throws SchemaValidationError on invalid source data from DynamoDB', async (t) => {
  const { knex, testCollection, testProvider } = t.context;

  const testPdr = generateTestPdr(testCollection, testProvider.name);

  delete testPdr.status;

  await t.throwsAsync(
    migratePdrRecord(testPdr, knex),
    { name: 'SchemaValidationError' }
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

  const testPdr = generateTestPdr(testCollection, testProvider.name);

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

test.serial('migratePdrRecord throws RecordAlreadyMigrated error for already migrated record', async (t) => {
  const { knex, testCollection, testProvider } = t.context;

  const testPdr = generateTestPdr(testCollection, testProvider.name);
  await migratePdrRecord(testPdr, knex);

  await t.throwsAsync(
    migratePdrRecord(testPdr, knex),
    { instanceOf: RecordAlreadyMigrated }
  );
});

test.serial('migratePdrs skips already migrated record', async (t) => {
  const {
    knex,
    testCollection,
    testProvider,
  } = t.context;
  const testPdr = generateTestPdr(testCollection, testProvider.name);

  await migratePdrRecord(testPdr, knex);
  await pdrsModel.create(testPdr);

  const migrationSummary = await migratePdrs(process.env, knex);
  t.deepEqual(migrationSummary,
    {
      dynamoRecords: 1,
      skipped: 1,
      failed: 0,
      success: 0,
    });

  const records = await knex(tableNames.pdrs).where({ name: testPdr.pdrName });
  t.is(records.length, 1);
  t.teardown(() => pdrsModel.delete({ pdrName: testPdr.pdrName }));
});

test.serial('migratePdrs processes multiple PDR records', async (t) => {
  const {
    collectionPgModel,
    knex,
    providerPgModel,
    testCollection,
    testProvider,
  } = t.context;

  const fakeCollection = fakeCollectionRecordFactory();
  const fakeProvider = fakeProviderRecordFactory();
  await collectionPgModel.create(knex, fakeCollection);
  await providerPgModel.create(knex, fakeProvider);

  const testPdr = generateTestPdr(testCollection, testProvider.name);
  const anotherPdr = generateTestPdr(fakeCollection, fakeProvider.name);

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
    dynamoRecords: 2,
    skipped: 0,
    failed: 0,
    success: 2,
  });
  const records = await knex(tableNames.pdrs);
  t.is(records.length, 2);
});

test.serial('migratePdrs processes all non-failing records', async (t) => {
  const {
    collectionPgModel,
    knex,
    providerPgModel,
    testCollection,
    testProvider,
  } = t.context;

  const fakeCollection = fakeCollectionRecordFactory();
  const fakeProvider = fakeProviderRecordFactory();
  await collectionPgModel.create(knex, fakeCollection);
  await providerPgModel.create(knex, fakeProvider);

  const testPdr = generateTestPdr(testCollection, testProvider.name);
  const anotherPdr = generateTestPdr(fakeCollection, fakeProvider.name);
  delete testPdr.status;

  await Promise.all([
    // Have to use Dynamo client directly because creating
    // via model won't allow creation of an invalid record
    dynamodbDocClient().put({
      TableName: process.env.PdrsTable,
      Item: testPdr,
    }).promise(),
    pdrsModel.create(anotherPdr),
  ]);
  t.teardown(() => Promise.all([
    pdrsModel.delete({ pdrName: testPdr.pdrName }),
    pdrsModel.delete({ pdrName: anotherPdr.pdrName }),
  ]));
  const migrationSummary = await migratePdrs(process.env, knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 2,
    skipped: 0,
    failed: 1,
    success: 1,
  });
  const records = await knex(tableNames.pdrs);
  t.is(records.length, 1);
});

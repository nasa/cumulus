const test = require('ava');
const sinon = require('sinon');
const cryptoRandomString = require('crypto-random-string');

const Collection = require('@cumulus/api/models/collections');
const Execution = require('@cumulus/api/models/executions');
const Granule = require('@cumulus/api/models/granules');
const Pdr = require('@cumulus/api/models/pdrs');
const Provider = require('@cumulus/api/models/providers');

const Logger = require('@cumulus/logger');

const { fakeFileFactory } = require('@cumulus/api/lib/testUtils');
const { randomId } = require('@cumulus/common/test-utils');

const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');

const {
  CollectionPgModel,
  destroyLocalTestDb,
  ExecutionPgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeProviderRecordFactory,
  generateLocalTestDb,
  localStackConnectionEnv,
  PdrPgModel,
  ProviderPgModel,
} = require('@cumulus/db');

// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../db-migration');
const { handler } = require('../dist/lambda');

const testDbName = `data_migration_2_${cryptoRandomString({ length: 10 })}`;
const dateString = new Date().toString();

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
    stackName: cryptoRandomString({ length: 10 }),
    system_bucket: cryptoRandomString({ length: 10 }),
    CollectionsTable: cryptoRandomString({ length: 10 }),
    ExecutionsTable: cryptoRandomString({ length: 10 }),
    GranulesTable: cryptoRandomString({ length: 10 }),
    PdrsTable: cryptoRandomString({ length: 10 }),
    ProvidersTable: cryptoRandomString({ length: 10 }),
  };

  await createBucket(process.env.system_bucket);

  t.context.collectionsModel = new Collection();
  t.context.executionsModel = new Execution();
  t.context.granulesModel = new Granule();
  t.context.pdrsModel = new Pdr();
  t.context.providersModel = new Provider();

  await Promise.all([
    t.context.collectionsModel.createTable(),
    t.context.executionsModel.createTable(),
    t.context.granulesModel.createTable(),
    t.context.pdrsModel.createTable(),
    t.context.providersModel.createTable(),
  ]);

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
});

test.beforeEach(async (t) => {
  t.context.pdrPgModel = new PdrPgModel();

  const collectionPgModel = new CollectionPgModel();
  const testCollection = fakeCollectionRecordFactory();
  await collectionPgModel.create(
    t.context.knex,
    testCollection
  );
  t.context.testCollection = testCollection;

  const providerPgModel = new ProviderPgModel();
  const testProvider = fakeProviderRecordFactory();

  await providerPgModel.create(
    t.context.knex,
    testProvider
  );
  t.context.testProvider = testProvider;

  const executionPgModel = new ExecutionPgModel();
  const executionUrl = cryptoRandomString({ length: 5 });
  t.context.executionUrl = executionUrl;

  const testExecution = fakeExecutionRecordFactory({
    url: executionUrl,
  });
  await executionPgModel.create(
    t.context.knex,
    testExecution
  );
  t.context.testExecution = testExecution;
});

test.after.always(async (t) => {
  await t.context.granulesModel.deleteTable();
  await t.context.pdrsModel.deleteTable();
  await t.context.providersModel.deleteTable();
  await t.context.collectionsModel.deleteTable();
  await t.context.executionsModel.deleteTable();

  await recursivelyDeleteS3Bucket(process.env.system_bucket);

  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test.serial('handler migrates executions, granules, files, and PDRs', async (t) => {
  const {
    executionsModel,
    granulesModel,
    pdrsModel,
    testCollection,
    testExecution,
    testProvider,
  } = t.context;

  const fakeFile = () => fakeFileFactory({
    bucket: cryptoRandomString({ length: 10 }),
    key: cryptoRandomString({ length: 10 }),
    size: 1098034,
    fileName: 'MOD09GQ.A4369670.7bAGCH.006.0739896140643.hdf',
    checksum: 'checkSum01',
    checksumType: 'md5',
    type: 'data',
    source: 'source',
  });

  const fakeExecution = {
    arn: randomId('arn'),
    duration: 180.5,
    name: randomId('name'),
    execution: randomId('execution'),
    parentArn: undefined,
    error: { test: 'error' },
    status: 'completed',
    createdAt: Date.now() - 180.5 * 1000,
    updatedAt: Date.now(),
    timestamp: Date.now(),
    type: 'fakeWorkflow',
    originalPayload: { testInput: 'originalPayloadValue' },
    finalPayload: { testOutput: 'finalPayloadValue' },
    tasks: {},
    cumulusVersion: '1.0.0',
  };

  const fakeGranule = {
    granuleId: cryptoRandomString({ length: 5 }),
    collectionId: `${testCollection.name}___${testCollection.version}`,
    pdrName: undefined,
    provider: undefined,
    status: 'running',
    execution: testExecution.url,
    cmrLink: cryptoRandomString({ length: 10 }),
    published: false,
    duration: 10,
    files: [fakeFile()],
    error: {},
    productVolume: 1119742,
    timeToPreprocess: 0,
    beginningDateTime: dateString,
    endingDateTime: dateString,
    processingStartDateTime: dateString,
    processingEndDateTime: dateString,
    lastUpdateDateTime: dateString,
    timeToArchive: 0,
    productionDateTime: dateString,
    timestamp: Date.now(),
    updatedAt: Date.now(),
  };

  const testPdr = {
    pdrName: cryptoRandomString({ length: 5 }),
    collectionId: `${testCollection.name}___${testCollection.version}`,
    provider: testProvider.name,
    status: 'running',
    progress: 10,
    execution: testExecution.arn,
    PANSent: false,
    PANmessage: 'message',
    stats: { total: 1, completed: 0, failed: 0, processing: 1 },
    address: cryptoRandomString({ length: 5 }),
    originalUrl: cryptoRandomString({ length: 5 }),
    timestamp: Date.now(),
    duration: 10,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await Promise.all([
    executionsModel.create(fakeExecution),
    granulesModel.create(fakeGranule),
    pdrsModel.create(testPdr),
  ]);

  t.teardown(() => Promise.all([
    pdrsModel.delete({ pdrName: testPdr.pdrName }),
    granulesModel.delete({ granuleId: fakeGranule.granuleId }),
    executionsModel.delete({ arn: fakeExecution.arn }),
  ]));

  const call = await handler({ env: process.env });
  const expected = {
    MigrationSummary: {
      executions: {
        failed: 0,
        migrated: 1,
        skipped: 0,
        total_dynamo_db_records: 1,
      },
      granules: {
        failed: 0,
        migrated: 1,
        skipped: 0,
        total_dynamo_db_records: 1,
      },
      files: {
        failed: 0,
        migrated: 1,
        skipped: 0,
        total_dynamo_db_records: 1,
      },
      pdrs: {
        failed: 0,
        migrated: 1,
        skipped: 0,
        total_dynamo_db_records: 1,
      },
    },
  };
  t.deepEqual(call, expected);
});

test.serial('handler logs a summary within the defined interval', async (t) => {
  const logSpy = sinon.spy(Logger.prototype, 'info');
  await handler({ env: process.env });
  this.clock = sinon.useFakeTimers();
  t.true(logSpy.called);

  this.clock.tick(90001);
  t.true(logSpy.called);

  t.teardown(() => {
    logSpy.restore();
    this.clock.restore();
  });
});

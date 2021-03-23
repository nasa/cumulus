const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const Collection = require('@cumulus/api/models/collections');
const Execution = require('@cumulus/api/models/executions');
const Granule = require('@cumulus/api/models/granules');
const Pdr = require('@cumulus/api/models/pdrs');
const Provider = require('@cumulus/api/models/providers');

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
  PdrPgModel,
  ProviderPgModel,
  localStackConnectionEnv,
  tableNames,
} = require('@cumulus/db');

// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../db-migration');
const { handler } = require('../dist/lambda');

let collectionsModel;
let executionsModel;
let granulesModel;
let pdrsModel;
let providersModel;

const testDbName = `data_migration_2_${cryptoRandomString({ length: 10 })}`;
const dateString = new Date().toString();

test.before(async (t) => {
  process.env.stackName = cryptoRandomString({ length: 10 });
  process.env.system_bucket = cryptoRandomString({ length: 10 });

  process.env.ExecutionsTable = cryptoRandomString({ length: 10 });
  process.env.CollectionsTable = cryptoRandomString({ length: 10 });
  process.env.GranulesTable = cryptoRandomString({ length: 10 });
  process.env.PdrsTable = cryptoRandomString({ length: 10 });
  process.env.ProvidersTable = cryptoRandomString({ length: 10 });

  await createBucket(process.env.system_bucket);

  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  collectionsModel = new Collection();
  executionsModel = new Execution();
  granulesModel = new Granule();
  providersModel = new Provider();
  pdrsModel = new Pdr();

  await pdrsModel.createTable();
  await collectionsModel.createTable();
  await executionsModel.createTable();
  await granulesModel.createTable();
  await providersModel.createTable();

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

test.afterEach.always(async (t) => {
  await t.context.knex(tableNames.files).del();
  await t.context.knex(tableNames.granulesExecutions).del();
  await t.context.knex(tableNames.granules).del();
  await t.context.knex(tableNames.pdrs).del();
  await t.context.knex(tableNames.providers).del();
  await t.context.knex(tableNames.collections).del();
  await t.context.knex(tableNames.executions).del();
});

test.after.always(async (t) => {
  await granulesModel.deleteTable();
  await pdrsModel.deleteTable();
  await providersModel.deleteTable();
  await collectionsModel.deleteTable();
  await executionsModel.deleteTable();

  await recursivelyDeleteS3Bucket(process.env.system_bucket);

  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test('handler migrates executions, granules, files, and PDRs', async (t) => {
  const {
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
  const expected = `
      Migration summary:
        Executions:
          Out of 1 DynamoDB records:
            1 records migrated
            0 records skipped
            0 records failed
        Granules:
          Out of 1 DynamoDB records:
            1 records migrated
            0 records skipped
            0 records failed
        Files:
          Out of 1 DynamoDB records:
            1 records migrated
            0 records failed
        PDRs:
          Out of 1 DynamoDB records:
            1 records migrated
            0 records skipped
            0 records failed
    `;
  t.is(call, expected);
});

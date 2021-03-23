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
  t.context.collectionPgModel = collectionPgModel;

  const collectionResponse = await collectionPgModel.create(
    t.context.knex,
    testCollection
  );
  t.context.testCollection = testCollection;
  t.context.collectionCumulusId = collectionResponse[0];

  const executionPgModel = new ExecutionPgModel();
  const executionUrl = cryptoRandomString({ length: 5 });
  t.context.executionUrl = executionUrl;

  const testExecution = fakeExecutionRecordFactory({
    url: executionUrl,
  });
  const executionResponse = await executionPgModel.create(
    t.context.knex,
    testExecution
  );
  t.context.testExecution = testExecution;
  t.context.executionCumulusId = executionResponse[0];

  const providerPgModel = new ProviderPgModel();
  const testProvider = fakeProviderRecordFactory();

  const providerResponse = await providerPgModel.create(
    t.context.knex,
    testProvider
  );
  t.context.providerCumulusId = providerResponse[0];

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
  t.context.fakeFile = fakeFile;

  t.context.fakeGranule = {
    granuleId: cryptoRandomString({ length: 5 }),
    collectionId: `${testCollection.name}___${testCollection.version}`,
    pdrName: undefined,
    provider: undefined,
    status: 'running',
    execution: t.context.executionUrl,
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

  t.context.testPdr = {
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
});

test.afterEach.always(async (t) => {
  await t.context.knex(tableNames.collections).del();
  await t.context.knex(tableNames.files).del();
  await t.context.knex(tableNames.granulesExecutions).del();
  await t.context.knex(tableNames.granules).del();
  await t.context.knex(tableNames.collections).del();
  await t.context.knex(tableNames.pdrs).del();
  await t.context.knex(tableNames.providers).del();
  await t.context.knex(tableNames.executions).del();
});

test.after.always(async (t) => {
  await executionsModel.deleteTable();
  await granulesModel.deleteTable();
  await collectionsModel.deleteTable();
  await pdrsModel.deleteTable();

  await recursivelyDeleteS3Bucket(process.env.system_bucket);

  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test('handler migrates executions, granules, files, and PDRs', async (t) => {
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

  const createdRecord = await t.context.knex.queryBuilder()
    .select('cumulus_id')
    .table('collections')
    .where({ name: t.context.testCollection.name, version: t.context.testCollection.version })
    .first();

  const collectionCumulusId = await t.context.collectionPgModel.getRecordCumulusId(
    t.context.knex,
    { name: t.context.testCollection.name, version: t.context.testCollection.version }
  );
  console.log(collectionCumulusId);
  console.log(t.context.testCollection);
  console.log(createdRecord);
  await Promise.all([
    executionsModel.create(fakeExecution),
    granulesModel.create(t.context.fakeGranule),
    pdrsModel.create(t.context.testPdr),
  ]);

  t.teardown(() => Promise.all([
    executionsModel.delete(fakeExecution),
    granulesModel.delete(t.context.fakeGranule),
    pdrsModel.delete({ pdrName: t.context.testPdr.pdrName }),
  ]));

  const call = await handler({});
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

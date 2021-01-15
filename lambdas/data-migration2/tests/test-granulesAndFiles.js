const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');
const test = require('ava');

const Collection = require('@cumulus/api/models/collections');
const Execution = require('@cumulus/api/models/executions');

const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const {
  translateApiCollectionToPostgresCollection,
  translateApiExecutionToPostgresExecution,
  tableNames,
} = require('@cumulus/db');
const { getKnexClient, localStackConnectionEnv } = require('@cumulus/db');
const { fakeCollectionFactory, fakeExecutionFactoryV2 } = require('@cumulus/api/lib/testUtils');
// const { RecordAlreadyMigrated } = require('@cumulus/errors');

// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../db-migration');
const { migrateGranuleRecord, migrateFileRecord } = require('../dist/lambda/granulesAndFiles');

const migrateFakeCollectionRecord = async (record, knex) => {
  const updatedRecord = translateApiCollectionToPostgresCollection(record);
  const [id] = await knex(tableNames.collections).insert(updatedRecord).returning('cumulus_id');
  return id;
};

const migrateFakeExecutionRecord = async (record, knex) => {
  const updatedRecord = await translateApiExecutionToPostgresExecution(record, knex);
  const [id] = await knex(tableNames.executions).insert(updatedRecord).returning('cumulus_id');
  return id;
};

const buildCollectionId = (name, version) => `${name}___${version}`;

const generateTestGranule = (collection, executionId, pdrName, provider) => ({
  granuleId: cryptoRandomString({ length: 5 }),
  collectionId: buildCollectionId(collection.name, collection.version),
  pdrName: pdrName,
  provider: provider,
  status: 'running',
  execution: executionId,
  cmrLink: cryptoRandomString({ length: 10 }),
  published: true,
  duration: 10,
  files: [
    {
      checksum: 'checkSum01',
      checksumType: 'md5',
      fileName: 'MOD09GQ.A4369670.7bAGCH.006.0739896140643.hdf',
      size: 1098034,
      source: 's3://test/tf-SyncGranuleSuccess-1607005817091-test-data/files/MOD09GQ.A4369670.7bAGCH.006.0739896140643.hdf',
      type: 'data',
    },
    {
      fileName: 'MOD09GQ.A4369670.7bAGCH.006.0739896140643.hdf.met',
      size: 21708,
      source: 's3://test/tf-SyncGranuleSuccess-1607005817091-test-data/files/MOD09GQ.A4369670.7bAGCH.006.0739896140643.hdf',
      type: 'metadata',
    },
  ],
  error: {},
  productVolume: 1119742,
  timeToPreprocess: 0,
  beginningDateTime: Date.now(),
  endingDateTime: Date.now(),
  processingStartDateTime: Date.now(),
  processingEndDateTime: Date.now(),
  lastUpdateDateTime: Date.now(),
  timeToArchive: 0,
  productionDateTime: Date.now(),
  timestamp: Date.now(),
  createdAt: Date.now() - 200 * 1000,
  updatedAt: Date.now(),
});

let collectionsModel;
let executionsModel;

const testDbName = `data_migration_2_${cryptoRandomString({ length: 10 })}`;
const testDbUser = 'postgres';

test.before(async (t) => {
  process.env.stackName = cryptoRandomString({ length: 10 });
  process.env.system_bucket = cryptoRandomString({ length: 10 });

  process.env.CollectionsTable = cryptoRandomString({ length: 10 });
  process.env.ExecutionsTable = cryptoRandomString({ length: 10 });

  await createBucket(process.env.system_bucket);

  collectionsModel = new Collection();
  await collectionsModel.createTable();

  executionsModel = new Execution();
  await executionsModel.createTable();

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
  const testExecution = fakeExecutionFactoryV2({ parentArn: undefined });
  t.context.testCollection = testCollection;
  t.context.testExecution = testExecution;

  t.context.collectionCumulusId = await migrateFakeCollectionRecord(testCollection, t.context.knex);
  t.context.executionCumulusId = await migrateFakeExecutionRecord(testExecution, t.context.knex);
});

test.afterEach.always(async (t) => {
  await t.context.knex(tableNames.files).del();
  await t.context.knex(tableNames.granules).del();
  await t.context.knex(tableNames.collections).del();
  await t.context.knex(tableNames.executions).del();
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);

  await collectionsModel.deleteTable();
  await executionsModel.deleteTable();

  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${testDbName}"`);
  await t.context.knexAdmin.destroy();
});

test.serial('migrateGranuleRecord correctly migrates granule record', async (t) => {
  const {
    knex,
    testCollection,
    testExecution,
    collectionCumulusId,
    executionCumulusId,
  } = t.context;

  const testGranule = generateTestGranule(testCollection, testExecution.arn);
  await migrateGranuleRecord(testGranule, knex);

  const record = await t.context.knex.queryBuilder()
    .select()
    .table(tableNames.granules)
    .where({ granule_id: testGranule.granuleId, collection_cumulus_id: collectionCumulusId })
    .first();

  t.like(
    omit(record, ['cumulus_id']),
    omit({
      granule_id: testGranule.granuleId,
      status: testGranule.status,
      collection_cumulus_id: collectionCumulusId,
      published: testGranule.published,
      duration: testGranule.duration,
      time_to_archive: testGranule.timeToArchive,
      time_to_process: testGranule.timeToPreprocess,
      product_volume: testGranule.productVolume,
      error: testGranule.error,
      cmr_link: testGranule.cmrLink,
      execution_cumulus_id: executionCumulusId,
      pdr_cumulus_id: null,
      provider_cumulus_id: null,
      beginning_date_time: new Date(testGranule.beginningDateTime),
      ending_date_time: new Date(testGranule.endingDateTime),
      last_update_date_time: new Date(testGranule.lastUpdateDateTime),
      processing_end_date_time: new Date(testGranule.processingEndDateTime),
      processing_start_date_time: new Date(testGranule.processingStartDateTime),
      production_date_time: new Date(testGranule.productionDateTime),
      timestamp: new Date(testGranule.timestamp),
      created_at: new Date(testGranule.createdAt),
      updated_at: new Date(testGranule.updatedAt),
    },
    ['updated_at'])
  );
});

test.serial('migrateFileRecord correctly migrates file record', async (t) => {
  const {
    knex,
    testCollection,
    testExecution,
  } = t.context;

  const testGranule = generateTestGranule(testCollection, testExecution.arn);
  const testFile = testGranule.files[0];
  await migrateGranuleRecord(testGranule, knex);
  await migrateFileRecord(testFile, testGranule.granuleId, testGranule.collectionId, knex);

  const record = await t.context.knex.queryBuilder()
    .select()
    .table(tableNames.files)
    .first();
    // .where({ bucket: testFile.bucket, key: testFile.key });

  t.like(
    omit(record, ['cumulus_id']),
    omit({
      bucket: testFile.bucket ? testFile.bucket : null,
      checksum_value: testFile.checksum,
      checksum_type: testFile.checksumType,
      key: testFile.key ? testFile.key : null,
      file_size: testFile.size,
      file_name: testFile.fileName,
      source: testFile.source,
      type: testFile.type,
    },
    ['type'])
  );
});
/*
test.serial('migrateGranuleRecord throws error on invalid source data from DynamoDB', async (t) => {
});

test.serial('migrateGranuleRecord handles nullable fields on source execution data', async (t) => {
});

test.serial('migrateGranuleRecord throws RecordAlreadyMigrated error for already migrated record', async (t) => {
});

test.serial('migrateFileRecord throws error on invalid source data from DynamoDB', async (t) => {
});

test.serial('migrateFileRecord handles nullable fields on source execution data', async (t) => {
});

test.serial('migrateFileRecord throws RecordAlreadyMigrated error for already migrated record', async (t) => {
});

test.serial('migrateGranules skips already migrated record', async (t) => {
});

test.serial('migrateGranules process multiple granules', async (t) => {
});

test.serial('migrateGranules process all non-failing records', async (t) => {
});

test.serial('migrateFiles skips already migrated record', async (t) => {
});

test.serial('migrateFiles process multiple granules', async (t) => {
});

test.serial('migrateFiles process all non-failing records', async (t) => {
});
*/

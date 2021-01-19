const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');
const test = require('ava');

const Collection = require('@cumulus/api/models/collections');
const Execution = require('@cumulus/api/models/executions');
const Granule = require('@cumulus/api/models/granules');
const s3Utils = require('@cumulus/aws-client/S3');

const { createBucket } = require('@cumulus/aws-client/S3');
const { secretsManager } = require('@cumulus/aws-client/services');
const {
  translateApiCollectionToPostgresCollection,
  translateApiExecutionToPostgresExecution,
  tableNames,
} = require('@cumulus/db');
const { getKnexClient, localStackConnectionEnv } = require('@cumulus/db');
const { fakeCollectionFactory, fakeExecutionFactoryV2 } = require('@cumulus/api/lib/testUtils');
const { RecordAlreadyMigrated } = require('@cumulus/errors');

// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../db-migration');
const { migrateGranuleRecord, migrateFileRecord, migrateGranulesAndFiles } = require('../dist/lambda/granulesAndFiles');

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

const dateString = new Date().toString();
const bucket = cryptoRandomString({ length: 10 });

const generateTestGranule = (collection, executionId, alternateBucket, pdrName, provider) => ({
  granuleId: cryptoRandomString({ length: 5 }),
  collectionId: buildCollectionId(collection.name, collection.version),
  pdrName: pdrName,
  provider: provider,
  status: 'running',
  execution: executionId,
  cmrLink: cryptoRandomString({ length: 10 }),
  published: false,
  duration: 10,
  files: [
    {
      bucket: alternateBucket || bucket,
      key: cryptoRandomString({ length: 10 }),
      checksum: 'checkSum01',
      checksumType: 'md5',
      fileName: 'MOD09GQ.A4369670.7bAGCH.006.0739896140643.hdf',
      size: 1098034,
      source: 's3://test/tf-SyncGranuleSuccess-1607005817091-test-data/files/MOD09GQ.A4369670.7bAGCH.006.0739896140643.hdf',
      type: 'data',
    },
  ],
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
  createdAt: Date.now() - 200 * 1000,
  updatedAt: Date.now(),
});

let collectionsModel;
let executionsModel;
let granulesModel;

const testDbName = `data_migration_2_${cryptoRandomString({ length: 10 })}`;
const testDbUser = 'postgres';

test.before(async (t) => {
  await s3Utils.createBucket(bucket);
  process.env.stackName = cryptoRandomString({ length: 10 });
  process.env.system_bucket = bucket;

  process.env.CollectionsTable = cryptoRandomString({ length: 10 });
  process.env.ExecutionsTable = cryptoRandomString({ length: 10 });
  process.env.GranulesTable = cryptoRandomString({ length: 10 });

  collectionsModel = new Collection();
  await collectionsModel.createTable();

  executionsModel = new Execution();
  await executionsModel.createTable();

  granulesModel = new Granule();
  await granulesModel.createTable();

  // Store the CMR password
  process.env.cmr_password_secret_name = cryptoRandomString({ length: 5 });
  await secretsManager().createSecret({
    Name: process.env.cmr_password_secret_name,
    SecretString: cryptoRandomString({ length: 5 }),
  }).promise();

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
  t.context.testGranule = generateTestGranule(testCollection, testExecution.arn);
});

test.afterEach.always(async (t) => {
  await t.context.knex(tableNames.files).del();
  await t.context.knex(tableNames.granules).del();
  await t.context.knex(tableNames.collections).del();
  await t.context.knex(tableNames.executions).del();
});

test.after.always(async (t) => {
  await granulesModel.deleteTable();
  await collectionsModel.deleteTable();
  await executionsModel.deleteTable();

  await s3Utils.recursivelyDeleteS3Bucket(bucket);

  await secretsManager().deleteSecret({
    SecretId: process.env.cmr_password_secret_name,
    ForceDeleteWithoutRecovery: true,
  }).promise();
  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${testDbName}"`);
  await t.context.knexAdmin.destroy();
});

test.serial('migrateGranuleRecord correctly migrates granule record', async (t) => {
  const {
    collectionCumulusId,
    executionCumulusId,
    knex,
    testGranule,
  } = t.context;

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
    testGranule,
  } = t.context;

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

test.serial('migrateGranuleRecord throws error on invalid source data from DynamoDB', async (t) => {
  const {
    knex,
    testGranule,
  } = t.context;

  delete testGranule.collectionId;

  await t.throwsAsync(
    migrateGranuleRecord(testGranule, knex),
    { name: 'SchemaValidationError' }
  );
});

test.serial('migrateGranuleRecord handles nullable fields on source granule data', async (t) => {
  const {
    collectionCumulusId,
    executionCumulusId,
    knex,
    testGranule,
  } = t.context;

  delete testGranule.pdrName;
  delete testGranule.cmrLink;
  delete testGranule.published;
  delete testGranule.duration;
  delete testGranule.files;
  delete testGranule.error;
  delete testGranule.productVolume;
  delete testGranule.timeToPreprocess;
  delete testGranule.beginningDateTime;
  delete testGranule.endingDateTime;
  delete testGranule.processingStartDateTime;
  delete testGranule.processingEndDateTime;
  delete testGranule.lastUpdateDateTime;
  delete testGranule.timeToArchive;
  delete testGranule.productionDateTime;
  delete testGranule.timestamp;
  delete testGranule.provider;

  await migrateGranuleRecord(testGranule, knex);

  const record = await t.context.knex.queryBuilder()
    .select()
    .table(tableNames.granules)
    .where({ granule_id: testGranule.granuleId, collection_cumulus_id: collectionCumulusId })
    .first();

  t.like(
    omit(record, ['cumulus_id']),
    {
      granule_id: testGranule.granuleId,
      status: testGranule.status,
      collection_cumulus_id: collectionCumulusId,
      published: testGranule.published,
      duration: null,
      time_to_archive: null,
      time_to_process: null,
      product_volume: null,
      error: null,
      cmr_link: null,
      execution_cumulus_id: executionCumulusId,
      pdr_cumulus_id: null,
      provider_cumulus_id: null,
      beginning_date_time: null,
      ending_date_time: null,
      last_update_date_time: null,
      processing_end_date_time: null,
      processing_start_date_time: null,
      production_date_time: null,
      timestamp: null,
      created_at: new Date(testGranule.createdAt),
      updated_at: new Date(testGranule.updatedAt),
    }
  );
});

test.serial('migrateGranuleRecord throws RecordAlreadyMigrated error for already migrated record', async (t) => {
  const {
    knex,
    testGranule,
  } = t.context;

  await migrateGranuleRecord(testGranule, knex);

  await t.throwsAsync(
    migrateGranuleRecord(testGranule, knex),
    { instanceOf: RecordAlreadyMigrated }
  );
});

test.serial('migrateFileRecord handles nullable fields on source file data', async (t) => {
  const {
    knex,
    testGranule,
  } = t.context;

  const testFile = testGranule.files[0];

  delete testFile.bucket;
  delete testFile.checksum;
  delete testFile.checksumType;
  delete testFile.fileName;
  delete testFile.key;
  delete testFile.path;
  delete testFile.size;
  delete testFile.source;

  await migrateGranuleRecord(testGranule, knex);
  await migrateFileRecord(testFile, testGranule.granuleId, testGranule.collectionId, knex);

  const record = await t.context.knex.queryBuilder()
    .select()
    .table(tableNames.files)
    .first();
  // .where({ bucket: testFile.bucket, key: testFile.key });

  t.like(
    omit(record, ['cumulus_id']),
    {
      bucket: null,
      checksum_value: null,
      checksum_type: null,
      file_size: null,
      file_name: null,
      key: null,
      source: null,
    }
  );
});

test.serial('migrateGranulesAndFiles skips already migrated granule record', async (t) => {
  const {
    knex,
    testGranule,
  } = t.context;

  await Promise.all(testGranule.files.map((file) => s3Utils.s3PutObject({
    Bucket: file.bucket,
    Key: file.key,
    Body: 'some-body',
  })));
  await migrateGranuleRecord(testGranule, knex);
  await granulesModel.create(testGranule);

  t.teardown(() => {
    granulesModel.delete(testGranule);
  });

  const migrationSummary = await migrateGranulesAndFiles(process.env, knex);
  t.deepEqual(migrationSummary, {
    filesSummary: {
      dynamoRecords: 0,
      failed: 0,
      skipped: 0,
      success: 0,
    },
    granulesSummary: {
      dynamoRecords: 1,
      failed: 0,
      skipped: 1,
      success: 0,
    },
  });
  const records = await t.context.knex.queryBuilder().select().table(tableNames.granules);
  t.is(records.length, 1);
});

test.serial('migrateGranulesAndFiles processes multiple granules and files', async (t) => {
  const {
    knex,
    testGranule,
  } = t.context;

  const alternateBucket = cryptoRandomString({ length: 10 });
  await s3Utils.createBucket(alternateBucket);

  const testCollection2 = fakeCollectionFactory();
  const testExecution2 = fakeExecutionFactoryV2({ parentArn: undefined });

  await migrateFakeCollectionRecord(testCollection2, knex);
  await migrateFakeExecutionRecord(testExecution2, knex);

  const testGranule1 = testGranule;
  const testGranule2 = generateTestGranule(testCollection2, testExecution2.arn, alternateBucket);
  const files = testGranule1.files.concat(testGranule2.files);

  await Promise.all(files.flatMap((file) => s3Utils.s3PutObject({
    Bucket: file.bucket,
    Key: file.key,
    Body: 'some-body',
  })));

  await Promise.all([
    granulesModel.create(testGranule1),
    granulesModel.create(testGranule2),
  ]);

  t.teardown(async () => {
    granulesModel.delete({ granuleId: testGranule1.granuleId });
    granulesModel.delete({ granuleId: testGranule2.granuleId });
    await s3Utils.recursivelyDeleteS3Bucket(alternateBucket);
  });

  const migrationSummary = await migrateGranulesAndFiles(process.env, knex);
  t.deepEqual(migrationSummary, {
    filesSummary: {
      dynamoRecords: 2,
      failed: 0,
      skipped: 0,
      success: 2,
    },
    granulesSummary: {
      dynamoRecords: 2,
      failed: 0,
      skipped: 0,
      success: 2,
    },
  });
  const records = await t.context.knex.queryBuilder().select().table(tableNames.granules);
  const fileRecords = await t.context.knex.queryBuilder().select().table(tableNames.files);
  t.is(records.length, 2);
  t.is(fileRecords.length, 2);
});

test.serial.skip('migrateGranulesAndFiles processes all non-failing records', async (t) => {
});

test.serial.skip('migrateFileRecord throws RecordAlreadyMigrated error for already migrated record', async (t) => {
});

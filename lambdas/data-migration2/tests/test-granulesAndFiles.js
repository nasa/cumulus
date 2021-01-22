const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');
const test = require('ava');

const Collection = require('@cumulus/api/models/collections');
const Execution = require('@cumulus/api/models/executions');
const Granule = require('@cumulus/api/models/granules');
const s3Utils = require('@cumulus/aws-client/S3');

const { secretsManager, dynamodbDocClient } = require('@cumulus/aws-client/services');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  ExecutionPgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  FilePgModel,
  generateLocalTestDb,
  GranulePgModel,
  tableNames,
} = require('@cumulus/db');
const { RecordAlreadyMigrated } = require('@cumulus/errors');

// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../db-migration');
const { migrateGranuleRecord, migrateFileRecord, migrateGranulesAndFiles } = require('../dist/lambda/granulesAndFiles');

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

  t.context.granulePgModel = new GranulePgModel();
  t.context.filePgModel = new FilePgModel();

  // Store the CMR password
  process.env.cmr_password_secret_name = cryptoRandomString({ length: 5 });
  await secretsManager().createSecret({
    Name: process.env.cmr_password_secret_name,
    SecretString: cryptoRandomString({ length: 5 }),
  }).promise();

  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;
});

test.beforeEach(async (t) => {
  const collectionPgModel = new CollectionPgModel();
  const testCollection = fakeCollectionRecordFactory();

  const collectionResponse = await collectionPgModel.create(
    t.context.knex,
    testCollection
  );
  t.context.testCollection = testCollection;
  t.context.collectionCumulusId = collectionResponse[0];
  t.context.collectionPgModel = collectionPgModel;

  const executionPgModel = new ExecutionPgModel();
  const testExecution = fakeExecutionRecordFactory();

  const executionResponse = await executionPgModel.create(
    t.context.knex,
    testExecution
  );
  t.context.testExecution = testExecution;
  t.context.executionCumulusId = executionResponse[0];
  t.context.executionPgModel = executionPgModel;

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

  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test.serial('migrateGranuleRecord correctly migrates granule record', async (t) => {
  const {
    collectionCumulusId,
    executionCumulusId,
    granulePgModel,
    knex,
    testGranule,
  } = t.context;

  await migrateGranuleRecord(testGranule, knex);

  const record = await granulePgModel.get(knex, {
    granule_id: testGranule.granuleId,
    collection_cumulus_id: collectionCumulusId,
  });

  t.like(
    record,
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
    filePgModel,
    knex,
    testGranule,
  } = t.context;

  const testFile = testGranule.files[0];
  await migrateGranuleRecord(testGranule, knex);
  await migrateFileRecord(testFile, testGranule.granuleId, testGranule.collectionId, knex);

  // I am not sure how I can select a file where bucket and key are null
  const record = await filePgModel.get(knex, {});

  t.like(
    record,
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
    granulePgModel,
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

  const record = await granulePgModel.get(knex, {
    granule_id: testGranule.granuleId,
    collection_cumulus_id: collectionCumulusId,
  });

  t.like(
    record,
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
    filePgModel,
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

  // Also unsure of condition for null bucket and key
  const record = await filePgModel.get(knex, {});

  t.like(
    record,
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

  const records = await knex(tableNames.granules);
  t.is(records.length, 1);
});

test.serial('migrateGranulesAndFiles processes multiple granules and files', async (t) => {
  const {
    collectionPgModel,
    executionPgModel,
    knex,
    testGranule,
  } = t.context;

  const alternateBucket = cryptoRandomString({ length: 10 });
  await s3Utils.createBucket(alternateBucket);

  const testExecution2 = fakeExecutionRecordFactory();
  await executionPgModel.create(
    knex,
    testExecution2
  );

  const testCollection2 = fakeCollectionRecordFactory();
  await collectionPgModel.create(
    t.context.knex,
    testCollection2
  );

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
  const records = await knex(tableNames.granules);
  const fileRecords = await knex(tableNames.files);
  t.is(records.length, 2);
  t.is(fileRecords.length, 2);
});

test.serial('migrateGranulesAndFiles processes all non-failing granule records and does not process files of failling granule records', async (t) => {
  const {
    collectionPgModel,
    executionPgModel,
    knex,
    testGranule,
  } = t.context;

  const alternateBucket = cryptoRandomString({ length: 10 });
  await s3Utils.createBucket(alternateBucket);

  const testExecution2 = fakeExecutionRecordFactory();
  await executionPgModel.create(
    knex,
    testExecution2
  );

  const testCollection2 = fakeCollectionRecordFactory();
  await collectionPgModel.create(
    t.context.knex,
    testCollection2
  );

  const testGranule2 = generateTestGranule(testCollection2, testExecution2.arn, alternateBucket);
  // remove required field so record will fail
  delete testGranule.collectionId;

  await Promise.all([
    dynamodbDocClient().put({
      TableName: process.env.GranulesTable,
      Item: testGranule,
    }).promise(),
    granulesModel.create(testGranule2),
  ]);

  t.teardown(async () => {
    granulesModel.delete({ granuleId: testGranule.granuleId });
    granulesModel.delete({ granuleId: testGranule2.granuleId });
  });

  const migrationSummary = await migrateGranulesAndFiles(process.env, knex);
  t.deepEqual(migrationSummary, {
    filesSummary: {
      dynamoRecords: 1,
      failed: 0,
      skipped: 0,
      success: 1,
    },
    granulesSummary: {
      dynamoRecords: 2,
      failed: 1,
      skipped: 0,
      success: 1,
    },
  });
  const records = await knex(tableNames.granules);
  const fileRecords = await knex(tableNames.files);
  t.is(records.length, 1);
  t.is(fileRecords.length, 1);
});

test.serial.skip('migrateFileRecord throws RecordAlreadyMigrated error for already migrated record', async (t) => {
});

const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');
const sinon = require('sinon');
const test = require('ava');

const Granule = require('@cumulus/api/models/granules');
const s3Utils = require('@cumulus/aws-client/S3');
const Logger = require('@cumulus/logger');
const { InvalidArgument } = require('@cumulus/errors');
const { removeNilProperties } = require('@cumulus/common/util');

const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const { fakeFileFactory } = require('@cumulus/api/lib/testUtils');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  ExecutionPgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakePdrRecordFactory,
  fakeProviderRecordFactory,
  FilePgModel,
  generateLocalTestDb,
  GranulePgModel,
  GranulesExecutionsPgModel,
  PdrPgModel,
  ProviderPgModel,
  translateApiGranuleToPostgresGranule,
  migrationDir,
  createRejectableTransaction,
  translatePostgresGranuleToApiGranule,
} = require('@cumulus/db');
const { RecordAlreadyMigrated, PostgresUpdateFailed } = require('@cumulus/errors');
const { constructCollectionId } = require('@cumulus/message/Collections');

const {
  migrateGranuleRecord,
  migrateFileRecord,
  migrateGranuleAndFilesViaTransaction,
  queryAndMigrateGranuleDynamoRecords,
  migrateGranulesAndFiles,
} = require('../dist/lambda/granulesAndFiles');

const dateString = new Date().toString();
const bucket = cryptoRandomString({ length: 10 });

const fileOmitList = ['granule_cumulus_id', 'cumulus_id', 'created_at', 'updated_at'];
const fakeFile = () => fakeFileFactory({
  bucket,
  key: cryptoRandomString({ length: 10 }),
  size: 1098034,
  fileName: 'MOD09GQ.A4369670.7bAGCH.006.0739896140643.hdf',
  checksum: 'checkSum01',
  checksumType: 'md5',
  type: 'data',
  source: 'source',
});

const generateTestGranule = (params) => ({
  granuleId: cryptoRandomString({ length: 10 }),
  status: 'completed',
  cmrLink: cryptoRandomString({ length: 10 }),
  published: false,
  duration: 10,
  files: [
    fakeFile(),
  ],
  error: {},
  productVolume: '1119742',
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
  ...params,
});

let granulesModel;

const testDbName = `data_migration_2_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  await s3Utils.createBucket(bucket);
  process.env.stackName = cryptoRandomString({ length: 10 });
  process.env.system_bucket = bucket;

  process.env.GranulesTable = cryptoRandomString({ length: 10 });

  granulesModel = new Granule();
  await granulesModel.createTable();

  t.context.granulePgModel = new GranulePgModel();
  t.context.filePgModel = new FilePgModel();
  t.context.granulesExecutionsPgModel = new GranulesExecutionsPgModel();

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
  t.context.collectionPgModel = collectionPgModel;
  t.context.testCollection = testCollection;
  t.context.collectionCumulusId = collectionResponse[0].cumulus_id;

  const executionPgModel = new ExecutionPgModel();
  t.context.executionUrl = cryptoRandomString({ length: 5 });
  const testExecution = fakeExecutionRecordFactory({
    url: t.context.executionUrl,
  });

  const [pgExecution] = await executionPgModel.create(
    t.context.knex,
    testExecution
  );

  t.context.executionCumulusId = pgExecution.cumulus_id;
  t.context.testExecution = testExecution;

  const completedTestExecution = fakeExecutionRecordFactory({
    status: 'completed',
  });

  const [completedPgExecution] = await executionPgModel.create(
    t.context.knex,
    completedTestExecution
  );

  t.context.completedExecutionCumulusId = completedPgExecution.cumulus_id;
  t.context.completedTestExecution = completedTestExecution;

  const providerPgModel = new ProviderPgModel();
  t.context.testProvider = fakeProviderRecordFactory();

  const providerResponse = await providerPgModel.create(
    t.context.knex,
    t.context.testProvider
  );
  t.context.providerCumulusId = providerResponse[0].cumulus_id;

  const pdrPgModel = new PdrPgModel();
  const testPdr = fakePdrRecordFactory({
    collection_cumulus_id: t.context.collectionCumulusId,
    provider_cumulus_id: t.context.providerCumulusId,
  });
  const [pgPdr] = await pdrPgModel.create(
    t.context.knex,
    testPdr
  );
  t.context.pdrCumulusId = pgPdr.cumulus_id;
  t.context.testPdr = testPdr;
  t.context.pdrPgModel = pdrPgModel;

  t.context.testGranule = generateTestGranule({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    execution: t.context.executionUrl,
    pdrName: testPdr.name,
  });
});

test.after.always(async (t) => {
  await granulesModel.deleteTable();

  await s3Utils.recursivelyDeleteS3Bucket(bucket);

  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test.serial('migrateGranuleRecord correctly migrates granule record', async (t) => {
  const {
    collectionCumulusId,
    executionCumulusId,
    granulesExecutionsPgModel,
    granulePgModel,
    pdrCumulusId,
    knex,
    testGranule,
  } = t.context;

  const granuleCumulusId = await createRejectableTransaction(
    knex,
    (trx) => migrateGranuleRecord(testGranule, trx)
  );
  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: granuleCumulusId });
  });
  const record = await granulePgModel.get(knex, {
    cumulus_id: granuleCumulusId,
  });

  t.deepEqual(
    omit(record, ['cumulus_id']),
    {
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
      pdr_cumulus_id: pdrCumulusId,
      provider_cumulus_id: null,
      query_fields: null,
      beginning_date_time: new Date(testGranule.beginningDateTime),
      ending_date_time: new Date(testGranule.endingDateTime),
      last_update_date_time: new Date(testGranule.lastUpdateDateTime),
      processing_end_date_time: new Date(testGranule.processingEndDateTime),
      processing_start_date_time: new Date(testGranule.processingStartDateTime),
      production_date_time: new Date(testGranule.productionDateTime),
      timestamp: new Date(testGranule.timestamp),
      created_at: new Date(testGranule.createdAt),
      updated_at: new Date(testGranule.updatedAt),
    }
  );
  t.deepEqual(
    await granulesExecutionsPgModel.search(
      knex,
      { granule_cumulus_id: granuleCumulusId }
    ),
    [executionCumulusId].map((executionId) => ({
      granule_cumulus_id: Number(granuleCumulusId),
      execution_cumulus_id: executionId,
    }))
  );
});

test.serial('migrateGranuleRecord correctly migrates granule record with missing execution', async (t) => {
  const {
    collectionCumulusId,
    granulesExecutionsPgModel,
    granulePgModel,
    pdrCumulusId,
    knex,
    testGranule,
  } = t.context;

  const updatedTestGranule = { ...testGranule, execution: '' };

  const granuleCumulusId = await createRejectableTransaction(
    knex,
    (trx) => migrateGranuleRecord(updatedTestGranule, trx)
  );
  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: granuleCumulusId });
  });
  const record = await granulePgModel.get(knex, {
    cumulus_id: granuleCumulusId,
  });

  t.deepEqual(
    omit(record, ['cumulus_id']),
    {
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
      pdr_cumulus_id: pdrCumulusId,
      provider_cumulus_id: null,
      query_fields: null,
      beginning_date_time: new Date(testGranule.beginningDateTime),
      ending_date_time: new Date(testGranule.endingDateTime),
      last_update_date_time: new Date(testGranule.lastUpdateDateTime),
      processing_end_date_time: new Date(testGranule.processingEndDateTime),
      processing_start_date_time: new Date(testGranule.processingStartDateTime),
      production_date_time: new Date(testGranule.productionDateTime),
      timestamp: new Date(testGranule.timestamp),
      created_at: new Date(testGranule.createdAt),
      updated_at: new Date(testGranule.updatedAt),
    }
  );
  t.deepEqual(
    await granulesExecutionsPgModel.search(
      knex,
      { granule_cumulus_id: granuleCumulusId }
    ),
    []
  );
});

test.serial('migrateGranuleRecord successfully migrates granule record with missing execution', async (t) => {
  const {
    granulePgModel,
    knex,
    testGranule,
  } = t.context;

  // refer to non-existent execution
  testGranule.execution = cryptoRandomString({ length: 10 });

  const granuleCumulusId = await createRejectableTransaction(
    knex,
    (trx) => migrateGranuleRecord(testGranule, trx)
  );
  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: granuleCumulusId });
  });

  t.true(
    await granulePgModel.exists(knex, {
      cumulus_id: granuleCumulusId,
    })
  );
});

test.serial('migrateFileRecord correctly migrates file record', async (t) => {
  const {
    filePgModel,
    granulePgModel,
    knex,
    testGranule,
  } = t.context;

  const testFile = testGranule.files[0];
  const granule = await translateApiGranuleToPostgresGranule({
    dynamoRecord: testGranule,
    knexOrTransaction: knex,
  });
  const [pgGranule] = await granulePgModel.create(knex, granule);
  const granuleCumulusId = pgGranule.cumulus_id;
  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: granuleCumulusId });
  });

  await migrateFileRecord(testFile, granuleCumulusId, knex);

  const record = await filePgModel.get(knex, { bucket: testFile.bucket, key: testFile.key });

  t.deepEqual(
    omit(record, fileOmitList),
    {
      bucket: testFile.bucket,
      checksum_value: testFile.checksum,
      checksum_type: testFile.checksumType,
      key: testFile.key,
      path: null,
      file_size: testFile.size.toString(),
      file_name: testFile.fileName,
      source: testFile.source,
      type: testFile.type,
    }
  );
});

test.serial('migrateFileRecord correctly migrates file record with filename instead of bucket and key', async (t) => {
  const {
    filePgModel,
    granulePgModel,
    knex,
    testGranule,
  } = t.context;

  const testFile = fakeFileFactory({
    bucket: undefined,
    key: undefined,
    filename: 's3://cumulus-test-sandbox-private/someKey',
  });
  testGranule.files = [testFile];

  const granule = await translateApiGranuleToPostgresGranule({
    dynamoRecord: testGranule,
    knexOrTransaction: knex,
  });
  const [pgGranule] = await granulePgModel.create(knex, granule);
  const granuleCumulusId = pgGranule.cumulus_id;
  await migrateFileRecord(testFile, granuleCumulusId, knex);

  const record = await filePgModel.get(
    knex,
    { bucket: 'cumulus-test-sandbox-private', key: 'someKey' }
  );

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: granuleCumulusId });
  });

  t.deepEqual(
    omit(record, fileOmitList),
    {
      bucket: 'cumulus-test-sandbox-private',
      checksum_value: null,
      checksum_type: null,
      key: 'someKey',
      path: null,
      file_size: null,
      file_name: testFile.fileName,
      source: null,
      type: null,
    }
  );
});

test.serial('migrateGranuleRecord handles nullable fields on source granule data', async (t) => {
  const {
    collectionCumulusId,
    executionCumulusId,
    granulePgModel,
    granulesExecutionsPgModel,
    knex,
    testGranule,
  } = t.context;

  delete testGranule.pdrName;
  delete testGranule.cmrLink;
  delete testGranule.published;
  delete testGranule.duration;
  testGranule.files = [];
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
  delete testGranule.queryFields;
  delete testGranule.version;

  const granuleCumulusId = await createRejectableTransaction(
    knex,
    (trx) => migrateGranuleRecord(testGranule, trx)
  );
  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: granuleCumulusId });
  });

  const record = await granulePgModel.get(knex, {
    cumulus_id: granuleCumulusId,
  });

  t.deepEqual(
    omit(record, ['cumulus_id']),
    {
      granule_id: testGranule.granuleId,
      status: testGranule.status,
      collection_cumulus_id: collectionCumulusId,
      published: null,
      duration: null,
      time_to_archive: null,
      time_to_process: null,
      product_volume: null,
      error: null,
      cmr_link: null,
      pdr_cumulus_id: null,
      provider_cumulus_id: null,
      query_fields: null,
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
  t.deepEqual(
    await granulesExecutionsPgModel.search(
      knex,
      { granule_cumulus_id: granuleCumulusId }
    ),
    [executionCumulusId].map((executionId) => ({
      granule_cumulus_id: Number(granuleCumulusId),
      execution_cumulus_id: executionId,
    }))
  );
});

test.serial('migrateGranuleRecord throws RecordAlreadyMigrated error if previously migrated record is newer and migrationParams.migrateAndOverwrite is set to true', async (t) => {
  const {
    knex,
    testGranule,
  } = t.context;

  const testGranule1 = testGranule;
  const testGranule2 = {
    ...testGranule1,
    updatedAt: Date.now() - 1000,
  };

  const granuleCumulusId = await createRejectableTransaction(
    knex,
    (trx) => migrateGranuleRecord(testGranule, trx)
  );
  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: granuleCumulusId });
  });

  await t.throwsAsync(
    migrateGranuleRecord(testGranule2, knex),
    { instanceOf: RecordAlreadyMigrated }
  );
});

test.serial('migrateGranuleRecord throws error if upsert does not return any rows', async (t) => {
  const {
    knex,
    testCollection,
    completedTestExecution,
  } = t.context;

  // Create a granule in the "running" status.
  const testGranule = generateTestGranule({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    execution: completedTestExecution.url,
    updatedAt: Date.now() - 1000,
    status: 'running',
  });

  const granuleCumulusId = await createRejectableTransaction(
    knex,
    (trx) => migrateGranuleRecord(testGranule, trx)
  );

  // We do not allow updates on granules where the status is "running"
  // and a completed execution record has already been created to prevent out-of-order writes.
  // Attempting to migrate this granule will cause the upsert to
  // return 0 rows and the migration will fail
  const newerGranule = {
    ...testGranule,
    updatedAt: Date.now(),
  };

  await t.throwsAsync(
    migrateGranuleRecord(newerGranule, knex),
    { instanceOf: PostgresUpdateFailed }
  );

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: granuleCumulusId });
  });
});

test.serial('migrateGranuleRecord updates an already migrated record if the updated date is newer', async (t) => {
  const {
    knex,
    granulePgModel,
    testCollection,
    testExecution,
  } = t.context;

  const testGranule = generateTestGranule({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    execution: testExecution.url,
    status: 'completed',
    updatedAt: Date.now() - 1000,
  });

  await createRejectableTransaction(knex, (trx) => migrateGranuleRecord(testGranule, trx));

  const newerGranule = {
    ...testGranule,
    updatedAt: Date.now(),
  };

  const granuleCumulusId = await createRejectableTransaction(
    knex,
    (trx) => migrateGranuleRecord(newerGranule, trx)
  );
  const record = await granulePgModel.get(knex, {
    cumulus_id: granuleCumulusId,
  });

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: record.cumulus_id });
  });

  t.deepEqual(record.updated_at, new Date(newerGranule.updatedAt));
});

test.serial('migrateGranuleRecord supports undefined values in dynamo and overwrites defined values in Postgres when re-migrating', async (t) => {
  const {
    knex,
    granulePgModel,
    testCollection,
    testExecution,
    testProvider,
    testPdr,
  } = t.context;

  const testGranule = generateTestGranule({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    queryFields: { foo: cryptoRandomString({ length: 8 }) },
    execution: testExecution.url,
    provider: testProvider.name,
    pdrName: testPdr.name,
    status: 'completed',
    version: cryptoRandomString({ length: 3 }),
    updatedAt: Date.now() - 1000,
  });

  await createRejectableTransaction(knex, (trx) => migrateGranuleRecord(testGranule, trx));

  // get a list of nullable granule keys
  const nonNullablefields = [
    'granuleId',
    'collectionId',
    'createdAt',
    'updatedAt',
    'status',
    'execution',
    'files',
  ];
  const nullableGranuleFields = omit(testGranule, nonNullablefields);

  // Create object with only nullable fields as { field: undefined }
  const undefinedGranuleFields = {};
  Object.keys(nullableGranuleFields).forEach((field) => {
    undefinedGranuleFields[field] = undefined;
  });

  const newerGranule = {
    ...testGranule,
    ...undefinedGranuleFields,
    updatedAt: Date.now(),
  };

  const granuleCumulusId = await createRejectableTransaction(
    knex,
    (trx) => migrateGranuleRecord(newerGranule, trx)
  );
  const record = await granulePgModel.get(knex, {
    cumulus_id: granuleCumulusId,
  });

  // Convert the granule payload we're migrating to the Postgres Granule format
  const expectedPgGranule = await translateApiGranuleToPostgresGranule({
    dynamoRecord: newerGranule,
    knexOrTransaction: knex,
  });

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: record.cumulus_id });
  });

  // The expectedPgGranule is an object created outside of PG and does not have foreign keys
  // Remove null properties from the PG record before comparison. The second migration should have
  // replaced valid values with null values.
  t.deepEqual(removeNilProperties(record), {
    ...expectedPgGranule,
    cumulus_id: record.cumulus_id,
  });

  // Translate PG granule because `nullableGranuleFields` is in the API
  // Granule format
  const translatedApiRecord = await translatePostgresGranuleToApiGranule(
    { granulePgRecord: record, knexOrTransaction: knex }
  );

  // Redundant check explicitly asserting the undefined fields we passed in the second migration
  // are null or undefined.
  Object.keys(nullableGranuleFields).forEach((field) => {
    console.log(field, translatedApiRecord[field]);
    t.true(translatedApiRecord[field] === undefined);
  });
});

test.serial('migrateGranuleRecord updates an already migrated record if migrateAndOverwrite is set to "true"', async (t) => {
  const {
    knex,
    granulePgModel,
    testCollection,
    testExecution,
  } = t.context;

  const testGranule = generateTestGranule({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    execution: testExecution.url,
    status: 'completed',
    updatedAt: Date.now() - 1000,
  });

  await createRejectableTransaction(knex, (trx) => migrateGranuleRecord(testGranule, trx));

  const newerGranule = {
    ...testGranule,
    cmrLink: 'fakelink',
  };

  const granuleCumulusId = await createRejectableTransaction(
    knex,
    (trx) => migrateGranuleRecord(newerGranule, trx, { migrateAndOverwrite: 'true' })
  );
  const record = await granulePgModel.get(knex, {
    cumulus_id: granuleCumulusId,
  });

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: record.cumulus_id });
  });

  t.deepEqual(record.cmr_link, newerGranule.cmrLink);
});

test.serial('migrateGranuleRecord does not update an already migrated record and returns the granule.cumulus_id if migrateOnlyFiles is set to "true"', async (t) => {
  const {
    knex,
    granulePgModel,
    testCollection,
    testExecution,
  } = t.context;

  const testGranule = generateTestGranule({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    execution: testExecution.url,
    status: 'completed',
    updatedAt: Date.now() - 1000,
  });

  await createRejectableTransaction(knex, (trx) => migrateGranuleRecord(testGranule, trx));

  const oldRecord = await granulePgModel.search(knex, {
    granule_id: testGranule.granuleId,
  });

  const newerGranule = {
    ...testGranule,
    cmrLink: 'fakelink',
  };

  const granuleCumulusId = await createRejectableTransaction(
    knex,
    (trx) => migrateGranuleRecord(newerGranule, trx, { migrateOnlyFiles: 'true' })
  );
  const record = await granulePgModel.get(knex, {
    cumulus_id: granuleCumulusId,
  });

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: record.cumulus_id });
  });

  t.deepEqual(oldRecord[0], record);
});

test.serial('migrateGranuleRecord throws if migrateOnlyFiles is set to "true" and migrateAndOverwrite is set to true', async (t) => {
  const {
    knex,
    testCollection,
    testExecution,
  } = t.context;

  const granuleRecord = generateTestGranule({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    execution: testExecution.url,
    status: 'completed',
    updatedAt: Date.now() - 1000,
  });

  await t.throwsAsync(createRejectableTransaction(
    knex,
    (trx) => migrateGranuleRecord(granuleRecord, trx, { migrateOnlyFiles: 'true', migrateAndOverwrite: 'true' })
  ), { instanceOf: InvalidArgument });
});

test.serial('migrateFileRecord handles nullable fields on source file data', async (t) => {
  const {
    filePgModel,
    granulePgModel,
    knex,
    testGranule,
  } = t.context;

  const testFile = testGranule.files[0];

  delete testFile.checksum;
  delete testFile.checksumType;
  delete testFile.fileName;
  delete testFile.path;
  delete testFile.size;
  delete testFile.source;
  delete testFile.type;

  const granule = await translateApiGranuleToPostgresGranule({
    dynamoRecord: testGranule,
    knexOrTransaction: knex,
  });
  const [pgGranule] = await granulePgModel.create(knex, granule);
  const granuleCumulusId = pgGranule.cumulus_id;
  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: granuleCumulusId });
  });

  await migrateFileRecord(testFile, granuleCumulusId, knex);

  const record = await filePgModel.get(knex, { bucket: testFile.bucket, key: testFile.key });

  t.deepEqual(
    omit(record, fileOmitList),
    {
      bucket: testFile.bucket,
      key: testFile.key,
      checksum_value: null,
      checksum_type: null,
      file_size: null,
      file_name: null,
      source: null,
      path: null,
      type: null,
    }
  );
});

test.serial('migrateGranuleAndFilesViaTransaction skips already migrated granule record', async (t) => {
  const {
    knex,
    testGranule,
  } = t.context;

  await migrateGranuleAndFilesViaTransaction({
    dynamoRecord: testGranule,
    knex,
    loggingInterval: 1,
  });

  t.teardown(() => {
    granulesModel.delete(testGranule);
  });

  const result = await migrateGranuleAndFilesViaTransaction({
    dynamoRecord: testGranule,
    knex,
    loggingInterval: 1,
  });

  t.deepEqual(result, {
    filesResult: {
      total_dynamo_db_records: 1,
      failed: 0,
      skipped: 1,
      migrated: 0,
    },
    granulesResult: {
      total_dynamo_db_records: 1,
      failed: 0,
      skipped: 1,
      migrated: 0,
    },
  });

  const records = await t.context.granulePgModel.search(t.context.knex, {});
  t.is(records.length, 1);

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[0].cumulus_id });
  });
});

test.serial('migrateGranuleAndFilesViaTransaction processes granule with no files', async (t) => {
  const {
    knex,
    testGranule,
  } = t.context;

  testGranule.files = [];

  await migrateGranuleAndFilesViaTransaction({
    dynamoRecord: testGranule,
    knex,
    loggingInterval: 1,
  });

  const records = await t.context.granulePgModel.search(t.context.knex, {});
  const fileRecords = await t.context.filePgModel.search(t.context.knex, {});
  t.is(records.length, 1);
  t.is(fileRecords.length, 0);

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[0].cumulus_id });
  });
});

test.serial('migrateGranuleAndFilesViaTransaction removes previously migrated files if a granule is re-migrated with an undefined files key', async (t) => {
  const {
    knex,
    testGranule,
  } = t.context;

  // migrate 1st time
  await migrateGranuleAndFilesViaTransaction({
    dynamoRecord: testGranule,
    knex,
    loggingInterval: 1,
  });

  // change api (dynamo) granule to have files undefined
  testGranule.files = undefined;

  // migrate 2nd time
  const result = await migrateGranuleAndFilesViaTransaction({
    dynamoRecord: testGranule,
    knex,
    loggingInterval: 1,
    migrateAndOverwrite: 'true',
  });

  const records = await t.context.granulePgModel.search(t.context.knex, {});
  const fileRecords = await t.context.filePgModel.search(t.context.knex, {});
  t.is(records.length, 1);
  t.is(fileRecords.length, 0);

  t.deepEqual(result, {
    filesResult: {
      total_dynamo_db_records: 0,
      failed: 0,
      skipped: 0,
      migrated: 0,
    },
    granulesResult: {
      total_dynamo_db_records: 1,
      failed: 0,
      skipped: 0,
      migrated: 1,
    },
  });

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[0].cumulus_id });
  });
});

test.serial('migrateGranuleAndFilesViaTransaction removes previously migrated files if a granule is re-migrated with an empty array of files', async (t) => {
  const {
    knex,
    testGranule,
  } = t.context;

  // migrate 1st time
  await migrateGranuleAndFilesViaTransaction({
    dynamoRecord: testGranule,
    knex,
    loggingInterval: 1,
  });

  // change api (dynamo) granule to have empty array
  testGranule.files = [];

  // migrate 2nd time
  const result = await migrateGranuleAndFilesViaTransaction({
    dynamoRecord: testGranule,
    knex,
    loggingInterval: 1,
    migrateAndOverwrite: 'true',
  });

  const records = await t.context.granulePgModel.search(t.context.knex, {});
  const fileRecords = await t.context.filePgModel.search(t.context.knex, {});
  t.is(records.length, 1);
  t.is(fileRecords.length, 0);

  t.deepEqual(result, {
    filesResult: {
      total_dynamo_db_records: 0,
      failed: 0,
      skipped: 0,
      migrated: 0,
    },
    granulesResult: {
      total_dynamo_db_records: 1,
      failed: 0,
      skipped: 0,
      migrated: 1,
    },
  });

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[0].cumulus_id });
  });
});

test.serial('migrateGranuleAndFilesViaTransaction updates previously migrated files correctly if a granule is re-migrated with different files', async (t) => {
  const {
    knex,
    testGranule,
  } = t.context;

  const testFile1 = testGranule.files[0];
  const fakeFile2 = fakeFileFactory({
    bucket,
    key: cryptoRandomString({ length: 10 }),
    size: 1098034,
    fileName: cryptoRandomString({ length: 20 }),
    checksum: 'checkSum02',
    checksumType: 'md5',
    type: 'data',
    source: 'source2',
  });
  testGranule.files.push(fakeFile2);

  // migrate 1st time
  const firstResult = await migrateGranuleAndFilesViaTransaction({
    dynamoRecord: testGranule,
    knex,
    loggingInterval: 1,
  });

  const firstRecords = await t.context.granulePgModel.search(t.context.knex, {});
  const firstFileRecords = await t.context.filePgModel.search(t.context.knex, {});
  t.is(firstRecords.length, 1);
  t.is(firstFileRecords.length, 2);

  t.deepEqual(firstResult, {
    filesResult: {
      total_dynamo_db_records: 2,
      failed: 0,
      skipped: 0,
      migrated: 2,
    },
    granulesResult: {
      total_dynamo_db_records: 1,
      failed: 0,
      skipped: 0,
      migrated: 1,
    },
  });

  t.deepEqual(
    omit(firstFileRecords[0], fileOmitList),
    {
      bucket: testFile1.bucket,
      checksum_value: testFile1.checksum,
      checksum_type: testFile1.checksumType,
      key: testFile1.key,
      path: null,
      file_size: testFile1.size.toString(),
      file_name: testFile1.fileName,
      source: testFile1.source,
      type: testFile1.type,
    }
  );
  t.deepEqual(
    omit(firstFileRecords[1], fileOmitList),
    {
      bucket: fakeFile2.bucket,
      checksum_value: fakeFile2.checksum,
      checksum_type: fakeFile2.checksumType,
      key: fakeFile2.key,
      path: null,
      file_size: fakeFile2.size.toString(),
      file_name: fakeFile2.fileName,
      source: fakeFile2.source,
      type: fakeFile2.type,
    }
  );

  const fakeFile3 = fakeFileFactory({
    bucket,
    key: cryptoRandomString({ length: 10 }),
    size: 1234567,
    filename: cryptoRandomString({ length: 20 }),
    checksum: 'checkSum03',
    checksumType: 'md5',
    type: 'data',
    source: 'source3',
  });

  const fakeFile4 = fakeFileFactory({
    bucket,
    key: cryptoRandomString({ length: 10 }),
    size: 1987654,
    filename: cryptoRandomString({ length: 20 }),
    checksum: 'checkSum04',
    checksumType: 'md5',
    type: 'data',
    source: 'source4',
  });

  // change api (dynamo) granule files
  testGranule.files = [testFile1, fakeFile3, fakeFile4];

  // migrate 2nd time
  const secondResult = await migrateGranuleAndFilesViaTransaction({
    dynamoRecord: testGranule,
    knex,
    loggingInterval: 1,
    migrateAndOverwrite: 'true',
  });

  const secondRecords = await t.context.granulePgModel.search(t.context.knex, {});
  const secondFileRecords = await t.context.filePgModel.search(t.context.knex, {});
  t.is(secondRecords.length, 1);
  t.is(secondFileRecords.length, 3);

  t.deepEqual(secondResult, {
    filesResult: {
      total_dynamo_db_records: 3,
      failed: 0,
      skipped: 0,
      migrated: 3,
    },
    granulesResult: {
      total_dynamo_db_records: 1,
      failed: 0,
      skipped: 0,
      migrated: 1,
    },
  });

  t.deepEqual(
    omit(secondFileRecords[0], fileOmitList),
    {
      bucket: testFile1.bucket,
      checksum_value: testFile1.checksum,
      checksum_type: testFile1.checksumType,
      key: testFile1.key,
      path: null,
      file_size: testFile1.size.toString(),
      file_name: testFile1.fileName,
      source: testFile1.source,
      type: testFile1.type,
    }
  );
  t.deepEqual(
    omit(secondFileRecords[1], fileOmitList),
    {
      bucket: fakeFile3.bucket,
      checksum_value: fakeFile3.checksum,
      checksum_type: fakeFile3.checksumType,
      key: fakeFile3.key,
      path: null,
      file_size: fakeFile3.size.toString(),
      file_name: fakeFile3.fileName,
      source: fakeFile3.source,
      type: fakeFile3.type,
    }
  );
  t.deepEqual(
    omit(secondFileRecords[2], fileOmitList),
    {
      bucket: fakeFile4.bucket,
      checksum_value: fakeFile4.checksum,
      checksum_type: fakeFile4.checksumType,
      key: fakeFile4.key,
      path: null,
      file_size: fakeFile4.size.toString(),
      file_name: fakeFile4.fileName,
      source: fakeFile4.source,
      type: fakeFile4.type,
    }
  );

  t.teardown(async () => {
    await t.context.granulePgModel.delete(
      t.context.knex, { cumulus_id: secondRecords[0].cumulus_id }
    );
  });
});

test.serial('migrateGranuleAndFilesViaTransaction updates previously migrated file records correctly if the files are modified and the granule is re-migrated', async (t) => {
  const {
    knex,
    testGranule,
  } = t.context;

  const testFile1 = testGranule.files[0];
  const fakeFile2 = fakeFileFactory({
    bucket,
    key: cryptoRandomString({ length: 10 }),
    size: 1098034,
    fileName: cryptoRandomString({ length: 20 }),
    checksum: 'checkSum02',
    checksumType: 'md5',
    type: 'data',
    source: 'source2',
  });
  testGranule.files.push(fakeFile2);

  // migrate 1st time
  await migrateGranuleAndFilesViaTransaction({
    dynamoRecord: testGranule,
    knex,
    loggingInterval: 1,
  });

  const modifiedTestFile1 = omit(testFile1, ['size', 'checksum', 'checksumType', 'source', 'type']);
  const modifiedFakeFile2 = {
    ...fakeFile2,
    size: 98765,
    checksum: 'newCheckSum02',
    source: 'newSource2',
    fileName: 'newFileName02',
  };
  testGranule.files = [modifiedTestFile1, modifiedFakeFile2];

  // migrate 2nd time with modified files
  const result = await migrateGranuleAndFilesViaTransaction({
    dynamoRecord: testGranule,
    knex,
    loggingInterval: 1,
    migrateAndOverwrite: 'true',
  });

  const records = await t.context.granulePgModel.search(t.context.knex, {});
  const fileRecords = await t.context.filePgModel.search(t.context.knex, {});
  t.is(records.length, 1);
  t.is(fileRecords.length, 2);

  t.deepEqual(result, {
    filesResult: {
      total_dynamo_db_records: 2,
      failed: 0,
      skipped: 0,
      migrated: 2,
    },
    granulesResult: {
      total_dynamo_db_records: 1,
      failed: 0,
      skipped: 0,
      migrated: 1,
    },
  });

  t.deepEqual(
    omit(fileRecords[0], fileOmitList),
    {
      bucket: modifiedTestFile1.bucket,
      checksum_value: null,
      checksum_type: null,
      key: modifiedTestFile1.key,
      path: null,
      file_size: null,
      file_name: modifiedTestFile1.fileName,
      source: null,
      type: null,
    }
  );
  t.deepEqual(
    omit(fileRecords[1], fileOmitList),
    {
      bucket: modifiedFakeFile2.bucket,
      checksum_value: modifiedFakeFile2.checksum,
      checksum_type: modifiedFakeFile2.checksumType,
      key: modifiedFakeFile2.key,
      path: null,
      file_size: modifiedFakeFile2.size.toString(),
      file_name: modifiedFakeFile2.fileName,
      source: modifiedFakeFile2.source,
      type: modifiedFakeFile2.type,
    }
  );

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[0].cumulus_id });
  });
});

test.serial('queryAndMigrateGranuleDynamoRecords only processes records for specified collection', async (t) => {
  const {
    knex,
    testCollection,
    testExecution,
    testGranule,
  } = t.context;

  const collectionIdFilter = constructCollectionId(testCollection.name, testCollection.version);

  const testGranule2 = generateTestGranule({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    execution: testExecution.url,
  });

  // this record should not be migrated
  const testGranule3 = generateTestGranule({
    collectionId: constructCollectionId(cryptoRandomString({ length: 3 }), testCollection.version),
    execution: testExecution.url,
  });

  await Promise.all([
    granulesModel.create(testGranule),
    granulesModel.create(testGranule2),
    granulesModel.create(testGranule3),
  ]);

  t.teardown(async () => {
    await Promise.all([
      granulesModel.delete({ granuleId: testGranule.granuleId }),
      granulesModel.delete({ granuleId: testGranule2.granuleId }),
      granulesModel.delete({ granuleId: testGranule3.granuleId }),
    ]);
  });

  const migrationResult = await queryAndMigrateGranuleDynamoRecords({
    granulesTable: process.env.GranulesTable,
    knex,
    granuleMigrationParams: {
      collectionId: collectionIdFilter,
    },
    loggingInterval: 1,
  });
  t.deepEqual(migrationResult, {
    filesResult: {
      total_dynamo_db_records: 2,
      failed: 0,
      skipped: 0,
      migrated: 2,
    },
    granulesResult: {
      filters: {
        collectionId: collectionIdFilter,
      },
      total_dynamo_db_records: 2,
      failed: 0,
      skipped: 0,
      migrated: 2,
    },
  });
  const records = await t.context.granulePgModel.search(t.context.knex, {});
  t.is(records.length, 2);

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[0].cumulus_id });
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[1].cumulus_id });
  });
});

test.serial('queryAndMigrateGranuleDynamoRecords only processes records for specified granuleId', async (t) => {
  const {
    knex,
    testCollection,
    testExecution,
    testGranule,
  } = t.context;

  const testGranule2 = generateTestGranule({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    execution: testExecution.url,
  });

  // this record should not be migrated
  const testGranule3 = generateTestGranule({
    collectionId: constructCollectionId(cryptoRandomString({ length: 3 }), testCollection.version),
    execution: testExecution.url,
  });

  await Promise.all([
    granulesModel.create(testGranule),
    granulesModel.create(testGranule2),
    granulesModel.create(testGranule3),
  ]);

  t.teardown(async () => {
    await Promise.all([
      granulesModel.delete({ granuleId: testGranule.granuleId }),
      granulesModel.delete({ granuleId: testGranule2.granuleId }),
      granulesModel.delete({ granuleId: testGranule3.granuleId }),
    ]);
  });

  const migrationResult = await queryAndMigrateGranuleDynamoRecords({
    granulesTable: process.env.GranulesTable,
    knex,
    granuleMigrationParams: {
      granuleId: testGranule.granuleId,
    },
    loggingInterval: 1,
  });
  t.deepEqual(migrationResult, {
    filesResult: {
      total_dynamo_db_records: 1,
      failed: 0,
      skipped: 0,
      migrated: 1,
    },
    granulesResult: {
      filters: {
        granuleId: testGranule.granuleId,
      },
      total_dynamo_db_records: 1,
      failed: 0,
      skipped: 0,
      migrated: 1,
    },
  });
  const records = await t.context.granulePgModel.search(t.context.knex, {});
  t.is(records.length, 1);

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[0].cumulus_id });
  });
});

test.serial('migrateGranulesAndFiles throws if migrateAndOverwrite and migrateOnlyFiles are set to a non-bool string value', async (t) => {
  const {
    knex,
  } = t.context;

  await t.throwsAsync(
    migrateGranulesAndFiles(process.env, knex, {
      migrateAndOverwrite: 'foo',
      migrateOnlyFiles: 'true',
    }),
    { instanceOf: InvalidArgument }
  );

  await t.throwsAsync(
    migrateGranulesAndFiles(process.env, knex, {
      migrateAndOverwrite: 'true',
      migrateOnlyFiles: 'bar',
    }),
    { instanceOf: InvalidArgument }
  );
});

test.serial('migrateGranulesAndFiles properly handles improperly cased migration options', async (t) => {
  const {
    knex,
    testGranule,
    testExecution,
    testCollection,
  } = t.context;

  const testGranule1 = testGranule;
  const testGranule2 = generateTestGranule({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    execution: testExecution.url,
  });

  await Promise.all([
    granulesModel.create(testGranule1),
    granulesModel.create(testGranule2),
  ]);

  t.teardown(async () => {
    await Promise.all([
      granulesModel.delete({ granuleId: testGranule.granuleId }),
      granulesModel.delete({ granuleId: testGranule2.granuleId }),
    ]);
  });

  await t.throwsAsync(
    migrateGranulesAndFiles(process.env, knex, {
      migrateAndOverwrite: 'TrUe',
      migrateOnlyFiles: 'True',
    }),
    { instanceOf: InvalidArgument }
  );

  const migrationSummary = await migrateGranulesAndFiles(process.env, knex, {
    migrateAndOverwrite: 'fAlSe',
    migrateOnlyFiles: 'False',
  });
  t.deepEqual(migrationSummary, {
    filesResult: {
      total_dynamo_db_records: 2,
      failed: 0,
      skipped: 0,
      migrated: 2,
    },
    granulesResult: {
      total_dynamo_db_records: 2,
      failed: 0,
      skipped: 0,
      migrated: 2,
    },
  });
  const records = await t.context.granulePgModel.search(t.context.knex, {});
  const fileRecords = await t.context.filePgModel.search(t.context.knex, {});
  t.is(records.length, 2);
  t.is(fileRecords.length, 2);

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[0].cumulus_id });
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[1].cumulus_id });
  });
});

test.serial('migrateGranulesAndFiles throws if migrateAndOverwrite and migrateOnlyFiles are set to true', async (t) => {
  const {
    knex,
    testGranule,
    testExecution,
    testCollection,
  } = t.context;

  const testGranule1 = testGranule;
  const testGranule2 = generateTestGranule({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    execution: testExecution.url,
  });

  await Promise.all([
    granulesModel.create(testGranule1),
    granulesModel.create(testGranule2),
  ]);

  t.teardown(async () => {
    await Promise.all([
      granulesModel.delete({ granuleId: testGranule.granuleId }),
      granulesModel.delete({ granuleId: testGranule2.granuleId }),
    ]);
  });

  await t.throwsAsync(
    migrateGranulesAndFiles(process.env, knex, {
      migrateAndOverwrite: 'true',
      migrateOnlyFiles: 'true',
    }),
    { instanceOf: InvalidArgument }
  );
});

test.serial('migrateGranulesAndFiles reports failures if GranuleMigrationParams.migrateOnlyFiles is set to true and the granules were not previously migrated', async (t) => {
  const {
    knex,
    testGranule,
    testExecution,
    testCollection,
  } = t.context;

  const testGranule1 = testGranule;
  const testGranule2 = generateTestGranule({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    execution: testExecution.url,
  });

  await Promise.all([
    granulesModel.create(testGranule1),
    granulesModel.create(testGranule2),
  ]);

  t.teardown(async () => {
    await Promise.all([
      granulesModel.delete({ granuleId: testGranule.granuleId }),
      granulesModel.delete({ granuleId: testGranule2.granuleId }),
    ]);
  });

  const migrationSummary = await migrateGranulesAndFiles(process.env, knex, { migrateOnlyFiles: 'true' });
  t.deepEqual(migrationSummary, {
    filesResult: {
      total_dynamo_db_records: 2,
      failed: 2,
      skipped: 0,
      migrated: 0,
    },
    granulesResult: {
      total_dynamo_db_records: 2,
      failed: 2,
      skipped: 0,
      migrated: 0,
    },
  });
  const records = await t.context.granulePgModel.search(t.context.knex, {});
  const fileRecords = await t.context.filePgModel.search(t.context.knex, {});
  t.is(records.length, 0);
  t.is(fileRecords.length, 0);
});

test.serial('migrateGranulesAndFiles reports failures if GranuleMigrationParams.migrateOnlyFiles is set to true and the granules were not previously migrated and filter is applied', async (t) => {
  const {
    knex,
    testGranule,
    testExecution,
    testCollection,
  } = t.context;

  const collectionId = constructCollectionId(testCollection.name, testCollection.version);
  const testGranule1 = testGranule;
  const testGranule2 = generateTestGranule({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    execution: testExecution.url,
  });

  await Promise.all([
    granulesModel.create(testGranule1),
    granulesModel.create(testGranule2),
  ]);

  t.teardown(async () => {
    await Promise.all([
      granulesModel.delete({ granuleId: testGranule.granuleId }),
      granulesModel.delete({ granuleId: testGranule2.granuleId }),
    ]);
  });

  const migrationSummary = await migrateGranulesAndFiles(process.env, knex, { migrateOnlyFiles: 'true', collectionId });
  t.deepEqual(
    { ...migrationSummary, granulesResult: omit(migrationSummary.granulesResult, 'filters') },
    {
      filesResult: {
        total_dynamo_db_records: 2,
        failed: 2,
        skipped: 0,
        migrated: 0,
      },
      granulesResult: {
        total_dynamo_db_records: 2,
        failed: 2,
        skipped: 0,
        migrated: 0,
      },
    }
  );
  const records = await t.context.granulePgModel.search(t.context.knex, {});
  const fileRecords = await t.context.filePgModel.search(t.context.knex, {});
  t.is(records.length, 0);
  t.is(fileRecords.length, 0);
});

test.serial('migrateGranulesAndFiles processes multiple granules and files', async (t) => {
  const {
    knex,
    testCollection,
    testExecution,
    testGranule,
  } = t.context;

  const testGranule1 = testGranule;
  const testGranule2 = generateTestGranule({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    execution: testExecution.url,
  });

  await Promise.all([
    granulesModel.create(testGranule1),
    granulesModel.create(testGranule2),
  ]);

  t.teardown(async () => {
    await Promise.all([
      granulesModel.delete({ granuleId: testGranule.granuleId }),
      granulesModel.delete({ granuleId: testGranule2.granuleId }),
    ]);
  });

  const migrationSummary = await migrateGranulesAndFiles(process.env, knex);
  t.deepEqual(migrationSummary, {
    filesResult: {
      total_dynamo_db_records: 2,
      failed: 0,
      skipped: 0,
      migrated: 2,
    },
    granulesResult: {
      total_dynamo_db_records: 2,
      failed: 0,
      skipped: 0,
      migrated: 2,
    },
  });
  const records = await t.context.granulePgModel.search(t.context.knex, {});
  const fileRecords = await t.context.filePgModel.search(t.context.knex, {});
  t.is(records.length, 2);
  t.is(fileRecords.length, 2);

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[0].cumulus_id });
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[1].cumulus_id });
  });
});

test.serial('migrateGranulesAndFiles updates multiple granules and files when migrateAndOverwrite is set', async (t) => {
  const {
    filePgModel,
    granulePgModel,
    knex,
    testCollection,
    testExecution,
    testGranule,
  } = t.context;

  const testGranule1 = testGranule;
  const testGranule2 = generateTestGranule({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    execution: testExecution.url,
  });

  await granulesModel.create(testGranule1);

  t.teardown(async () => {
    await Promise.all([
      granulesModel.delete({ granuleId: testGranule.granuleId }),
      granulesModel.delete({ granuleId: testGranule2.granuleId }),
    ]);
  });

  const migrationSummary = await migrateGranulesAndFiles(process.env, knex);
  t.deepEqual(migrationSummary, {
    filesResult: {
      total_dynamo_db_records: 1,
      failed: 0,
      skipped: 0,
      migrated: 1,
    },
    granulesResult: {
      total_dynamo_db_records: 1,
      failed: 0,
      skipped: 0,
      migrated: 1,
    },
  });

  await granulesModel.create(testGranule2);

  const records = await granulePgModel.search(knex, {});
  const fileRecords = await filePgModel.search(knex, {});
  t.is(records.length, 1);
  t.is(fileRecords.length, 1);

  const updatedFile1 = { ...testGranule1.files[0], size: 1 };
  const updatedFile2 = { ...testGranule2.files[0], size: 1 };
  await Promise.all([
    granulesModel.update(
      { granuleId: testGranule1.granuleId },
      {
        timeToPreprocess: 500,
        updatedAt: Date.now() - 200 * 100000,
        files: [updatedFile1],
      }
    ),
    granulesModel.update(
      { granuleId: testGranule2.granuleId },
      {
        timeToPreprocess: 500,
        updatedAt: Date.now() - 200 * 100000,
        files: [updatedFile2],
      }
    ),
  ]);

  const updatedMigrationSummary = await migrateGranulesAndFiles(process.env, knex, { migrateAndOverwrite: 'true' });
  t.deepEqual(updatedMigrationSummary, {
    filesResult: {
      total_dynamo_db_records: 2,
      failed: 0,
      skipped: 0,
      migrated: 2,
    },
    granulesResult: {
      total_dynamo_db_records: 2,
      failed: 0,
      skipped: 0,
      migrated: 2,
    },
  });

  const updatedRecords = await granulePgModel.search(knex, {});
  const updatedFileRecords = await filePgModel.search(knex, {});

  updatedRecords.forEach((record) => {
    t.is(record.time_to_process, 500);
  });

  updatedFileRecords.forEach((fileRecord) => {
    t.is(fileRecord.file_size, '1');
  });

  t.teardown(async () => {
    const cleanupRecords = await granulePgModel.search(knex, {});
    await Promise.all(
      cleanupRecords.map((record) =>
        granulePgModel.delete(t.context.knex, { cumulus_id: record.cumulus_id }))
    );
  });
});

test.serial('migrateGranulesAndFiles processes multiple granules when a filter is applied', async (t) => {
  const {
    knex,
    testCollection,
    testExecution,
    testGranule,
  } = t.context;

  const collectionId = constructCollectionId(testCollection.name, testCollection.version);

  const testGranule1 = testGranule;
  const testGranule2 = generateTestGranule({
    collectionId,
    execution: testExecution.url,
  });

  await Promise.all([
    granulesModel.create(testGranule1),
    granulesModel.create(testGranule2),
  ]);

  t.teardown(async () => {
    await Promise.all([
      granulesModel.delete({ granuleId: testGranule.granuleId }),
      granulesModel.delete({ granuleId: testGranule2.granuleId }),
    ]);
  });

  const migrationSummary = await migrateGranulesAndFiles(
    process.env,
    knex,
    {
      collectionId,
    }
  );
  t.deepEqual(migrationSummary, {
    filesResult: {
      total_dynamo_db_records: 2,
      failed: 0,
      skipped: 0,
      migrated: 2,
    },
    granulesResult: {
      filters: {
        collectionId,
      },
      total_dynamo_db_records: 2,
      failed: 0,
      skipped: 0,
      migrated: 2,
    },
  });
  const records = await t.context.granulePgModel.search(t.context.knex, {});
  const fileRecords = await t.context.filePgModel.search(t.context.knex, {});
  t.is(records.length, 2);
  t.is(fileRecords.length, 2);

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[0].cumulus_id });
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[1].cumulus_id });
  });
});

test.serial('migrateGranulesAndFiles processes all non-failing granule records and does not process files of failing granule records', async (t) => {
  const {
    knex,
    testCollection,
    testExecution,
    testGranule,
  } = t.context;

  const testGranule2 = generateTestGranule({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    execution: testExecution.url,
  });

  // remove required field so record will fail
  delete testGranule.collectionId;

  await Promise.all([
    dynamodbDocClient().put({
      TableName: process.env.GranulesTable,
      Item: testGranule,
    }),
    granulesModel.create(testGranule2),
  ]);

  t.teardown(async () => {
    await Promise.all([
      granulesModel.delete({ granuleId: testGranule.granuleId }),
      granulesModel.delete({ granuleId: testGranule2.granuleId }),
    ]);
  });

  const migrationSummary = await migrateGranulesAndFiles(process.env, knex);
  t.deepEqual(migrationSummary, {
    filesResult: {
      total_dynamo_db_records: 2,
      failed: 1,
      skipped: 0,
      migrated: 1,
    },
    granulesResult: {
      total_dynamo_db_records: 2,
      failed: 1,
      skipped: 0,
      migrated: 1,
    },
  });
  const records = await t.context.granulePgModel.search(t.context.knex, {});
  const fileRecords = await t.context.filePgModel.search(t.context.knex, {});
  t.is(records.length, 1);
  t.is(fileRecords.length, 1);

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[0].cumulus_id });
  });
});

test.serial('migrateGranulesAndFiles processes all non-failing granule records when a filter is applied', async (t) => {
  const {
    knex,
    testCollection,
    testExecution,
    testGranule,
  } = t.context;

  const collectionId = constructCollectionId(testCollection.name, testCollection.version);
  const testGranule2 = generateTestGranule({
    collectionId,
    execution: testExecution.url,
  });
  // refer to non-existent provider to cause failure
  testGranule2.provider = cryptoRandomString({ length: 3 });

  await Promise.all([
    granulesModel.create(testGranule),
    granulesModel.create(testGranule2),
  ]);

  t.teardown(async () => {
    await Promise.all([
      granulesModel.delete({ granuleId: testGranule.granuleId }),
      granulesModel.delete({ granuleId: testGranule2.granuleId }),
    ]);
  });

  const migrationSummary = await migrateGranulesAndFiles(
    process.env,
    knex,
    {
      collectionId,
    }
  );
  t.deepEqual(migrationSummary, {
    filesResult: {
      total_dynamo_db_records: 2,
      failed: 1,
      skipped: 0,
      migrated: 1,
    },
    granulesResult: {
      filters: {
        collectionId,
      },
      total_dynamo_db_records: 2,
      failed: 1,
      skipped: 0,
      migrated: 1,
    },
  });
  const records = await t.context.granulePgModel.search(t.context.knex, {});
  const fileRecords = await t.context.filePgModel.search(t.context.knex, {});
  t.is(records.length, 1);
  t.is(fileRecords.length, 1);

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[0].cumulus_id });
  });
});

test.serial('migrateGranulesAndFiles writes errors to S3 object', async (t) => {
  const {
    collectionPgModel,
    pdrPgModel,
    knex,
    testCollection,
    testExecution,
    testGranule,
    testPdr,
  } = t.context;
  const key = `${process.env.stackName}/data-migration2-granulesAndFiles-errors-123.json`;

  const testCollection2 = fakeCollectionRecordFactory();
  const testGranule2 = generateTestGranule({
    collectionId: constructCollectionId(testCollection2.name, testCollection2.version),
    execution: testExecution.url,
  });
  // remove PDR record that references collection before removing collection record
  await pdrPgModel.delete(
    t.context.knex,
    testPdr
  );

  // remove collection record references so migration will fail
  await collectionPgModel.delete(
    t.context.knex,
    testCollection
  );

  await Promise.all([
    granulesModel.create(testGranule),
    granulesModel.create(testGranule2),
  ]);

  t.teardown(async () => {
    await Promise.all([
      granulesModel.delete({ granuleId: testGranule.granuleId }),
      granulesModel.delete({ granuleId: testGranule2.granuleId }),
    ]);
  });

  await migrateGranulesAndFiles(process.env, knex, {}, '123');
  // Check that error file exists in S3
  const errorReportJson = await s3Utils.getJsonS3Object(
    process.env.system_bucket,
    key
  );
  const { errors } = errorReportJson;
  const expectedResult = /RecordDoesNotExist/;

  t.is(errors.length, 2);
  t.true(expectedResult.test(errors[0]));
  t.true(expectedResult.test(errors[1]));
});

test.serial('migrateGranulesAndFiles correctly delimits errors written to S3 object', async (t) => {
  const {
    knex,
    testExecution,
    testGranule,
  } = t.context;
  const key = `${process.env.stackName}/data-migration2-granulesAndFiles-errors-123.json`;

  const testCollection2 = fakeCollectionRecordFactory();
  const testGranule2 = generateTestGranule({
    collectionId: constructCollectionId(testCollection2.name, testCollection2.version),
    execution: testExecution.url,
  });

  await Promise.all([
    granulesModel.create(testGranule),
    granulesModel.create(testGranule2),
  ]);

  // Prematurely migrate granule, will be skipped and exluded from error file
  await migrateGranuleRecord(testGranule, knex);

  t.teardown(async () => {
    await Promise.all([
      granulesModel.delete({ granuleId: testGranule.granuleId }),
      granulesModel.delete({ granuleId: testGranule2.granuleId }),
    ]);
  });

  await migrateGranulesAndFiles(process.env, knex, {}, '123');
  // Check that error file exists in S3
  const errorReportJson = await s3Utils.getJsonS3Object(
    process.env.system_bucket,
    key
  );
  const { errors } = errorReportJson;
  const expectedResult = /RecordDoesNotExist/;

  t.is(errors.length, 1);
  t.true(expectedResult.test(errors[0]));
});

test.serial('migrateGranulesAndFiles logs summary of migration for a specified loggingInterval', async (t) => {
  const logSpy = sinon.spy(Logger.prototype, 'info');
  const {
    knex,
    testGranule,
    testCollection,
  } = t.context;

  const testGranule2 = generateTestGranule({
    collectionId: constructCollectionId(testCollection.name, testCollection.version),
    execution: t.context.executionUrl,
  });

  await granulesModel.create(testGranule);
  await granulesModel.create(testGranule2);

  t.teardown(async () => {
    logSpy.restore();
    await granulesModel.delete(testGranule);
    await granulesModel.delete(testGranule2);
  });

  await migrateGranulesAndFiles(
    process.env,
    knex,
    {
      loggingInterval: 1,
      parallelScanLimit: 1,
    }
  );
  t.true(logSpy.calledWith('Batch of 1 granule records processed, 1 total'));
  t.true(logSpy.calledWith('Batch of 1 granule records processed, 2 total'));
});

test.serial('migrateGranulesAndFiles logs summary of migration for a specified loggingInterval with filters applied', async (t) => {
  const logSpy = sinon.spy(Logger.prototype, 'info');
  const {
    knex,
    testGranule,
    testCollection,
  } = t.context;

  const collectionId = constructCollectionId(testCollection.name, testCollection.version);
  const testGranule2 = generateTestGranule({
    collectionId,
    execution: t.context.executionUrl,
  });

  await granulesModel.create(testGranule);
  await granulesModel.create(testGranule2);

  t.teardown(async () => {
    logSpy.restore();
    await granulesModel.delete(testGranule);
    await granulesModel.delete(testGranule2);
  });

  await migrateGranulesAndFiles(
    process.env,
    knex,
    {
      collectionId,
      loggingInterval: 1,
      parallelScanLimit: 1,
    }
  );
  t.true(logSpy.calledWith('Batch of 1 granule records processed, 1 total'));
  t.true(logSpy.calledWith('Batch of 1 granule records processed, 2 total'));
});

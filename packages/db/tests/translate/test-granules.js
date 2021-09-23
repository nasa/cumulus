const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { ValidationError } = require('@cumulus/errors');
const { getExecutionUrlFromArn } = require('@cumulus/message/Executions');

const {
  CollectionPgModel,
  ExecutionPgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeFileRecordFactory,
  fakeGranuleRecordFactory,
  fakePdrRecordFactory,
  fakeProviderRecordFactory,
  FilePgModel,
  generateLocalTestDb,
  GranulePgModel,
  GranulesExecutionsPgModel,
  PdrPgModel,
  ProviderPgModel,
  migrationDir,
  translateApiGranuleToPostgresGranule,
  translatePostgresGranuleToApiGranule,
} = require('../../dist');

const testDbName = `granule_${cryptoRandomString({ length: 10 })}`;

const createdAt = new Date(Date.now() - 100 * 1000);
const updatedAt = new Date(Date.now());

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  // Create collection
  t.context.collectionPgModel = new CollectionPgModel();
  t.context.collection = fakeCollectionRecordFactory({ name: 'collectionName', version: 'collectionVersion' });
  const [collectionPgRecord] = await t.context.collectionPgModel.create(
    knex,
    t.context.collection
  );
  const collectionCumulusId = collectionPgRecord.cumulus_id;

  // Create provider
  t.context.providerPgModel = new ProviderPgModel();
  const provider = fakeProviderRecordFactory({ name: 'providerName' });
  const [providerCumulusId] = await t.context.providerPgModel.create(knex, provider);

  // Create PDR
  t.context.pdrPgModel = new PdrPgModel();
  const pdr = fakePdrRecordFactory({
    name: 'pdrName',
    collection_cumulus_id: collectionCumulusId,
    provider_cumulus_id: providerCumulusId,
  });
  const [pdrCumulusId] = await t.context.pdrPgModel.create(knex, pdr);

  // Create Granule
  t.context.granulePgModel = new GranulePgModel();
  [t.context.granuleCumulusId] = await t.context.granulePgModel.create(
    knex,
    fakeGranuleRecordFactory({
      beginning_date_time: new Date(Date.now() - 300 * 1000),
      cmr_link: cryptoRandomString({ length: 10 }),
      collection_cumulus_id: collectionCumulusId,
      created_at: new Date(Date.now() - 200 * 1000),
      duration: 10.1,
      ending_date_time: new Date(Date.now() - 250 * 1000),
      error: {},
      granule_id: cryptoRandomString({ length: 5 }),
      last_update_date_time: new Date(Date.now() - 100 * 1000),
      pdr_cumulus_id: pdrCumulusId,
      processing_end_date_time: new Date(Date.now() - 500 * 1000),
      processing_start_date_time: new Date(Date.now() - 400 * 1000),
      product_volume: 1119742,
      production_date_time: new Date(Date.now() - 350 * 1000),
      provider_cumulus_id: providerCumulusId,
      published: false,
      query_fields: { foo: 'bar' },
      status: 'running',
      time_to_archive: 0,
      time_to_process: 0,
      timestamp: new Date(Date.now() - 120 * 1000),
      updated_at: new Date(Date.now()),
    })
  );

  // Create executions
  const executionPgModel = new ExecutionPgModel();
  const [executionA] = await executionPgModel.create(
    knex,
    fakeExecutionRecordFactory({ timestamp: new Date(Date.now()) })
  );
  const [executionB] = await executionPgModel.create(
    knex,
    fakeExecutionRecordFactory({ timestamp: new Date(Date.now() - 555 * 1000) })
  );

  const executionACumulusId = executionA.cumulus_id;
  const executionBCumulusId = executionB.cumulus_id;

  t.context.executions = [
    await executionPgModel.get(knex, { cumulus_id: executionACumulusId }),
    await executionPgModel.get(knex, { cumulus_id: executionBCumulusId }),
  ];

  // Create GranulesExecuions JOIN records
  const granulesExecutionsPgModel = new GranulesExecutionsPgModel();
  await granulesExecutionsPgModel.create(
    knex,
    {
      granule_cumulus_id: t.context.granuleCumulusId,
      execution_cumulus_id: executionACumulusId,
    }
  );
  await granulesExecutionsPgModel.create(
    knex,
    {
      granule_cumulus_id: t.context.granuleCumulusId,
      execution_cumulus_id: executionBCumulusId,
    }
  );

  // Create files
  t.context.filePgModel = new FilePgModel();
  const files = [
    fakeFileRecordFactory({
      bucket: 'cumulus-test-sandbox-private',
      checksum_type: 'md5',
      checksum_value: 'bogus-value',
      created_at: createdAt,
      file_name: 's3://cumulus-test-sandbox-private/firstKey',
      file_size: 2098711627776,
      granule_cumulus_id: 1,
      key: 'firstKey',
      path: 's3://cumulus-test-sandbox-private/sourceDir/firstKey',
      source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      updated_at: updatedAt,
    }),
    fakeFileRecordFactory({
      bucket: 'cumulus-test-sandbox-private',
      checksum_type: 'md5',
      checksum_value: 'bogus-value',
      created_at: createdAt,
      file_name: 's3://cumulus-test-sandbox-private/secondKey',
      file_size: 1099511627776,
      granule_cumulus_id: 1,
      key: 'secondKey',
      path: 's3://cumulus-test-sandbox-private/sourceDir/secondKey',
      source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      updated_at: updatedAt,
    }),
  ];
  files.map(async (file) => await t.context.filePgModel.create(knex, file));
});

test('translatePostgresGranuleToApiGranule converts Postgres granule to API granule', async (t) => {
  const {
    knex,
    pdrPgModel,
    providerPgModel,
    collectionPgModel,
    filePgModel,
    granulePgModel,
    granuleCumulusId,
    executions,
  } = t.context;

  const postgresGranule = await granulePgModel.get(knex, { cumulus_id: granuleCumulusId });

  const expectedApiGranule = {
    beginningDateTime: postgresGranule.beginning_date_time.toISOString(),
    cmrLink: postgresGranule.cmr_link,
    collectionId: 'collectionName___collectionVersion',
    createdAt: postgresGranule.created_at.getTime(),
    duration: postgresGranule.duration,
    endingDateTime: postgresGranule.ending_date_time.toISOString(),
    error: postgresGranule.error,
    execution: getExecutionUrlFromArn(executions[0].arn),
    granuleId: postgresGranule.granule_id,
    lastUpdateDateTime: postgresGranule.last_update_date_time.toISOString(),
    pdrName: 'pdrName',
    processingEndDateTime: postgresGranule.processing_end_date_time.toISOString(),
    processingStartDateTime: postgresGranule.processing_start_date_time.toISOString(),
    productionDateTime: postgresGranule.production_date_time.toISOString(),
    productVolume: Number.parseInt(postgresGranule.product_volume, 10),
    provider: 'providerName',
    published: postgresGranule.published,
    queryFields: postgresGranule.query_fields,
    status: postgresGranule.status,
    timestamp: postgresGranule.timestamp.getTime(),
    timeToArchive: postgresGranule.time_to_archive,
    timeToPreprocess: postgresGranule.time_to_process,
    updatedAt: postgresGranule.updated_at.getTime(),
    files: [
      {
        bucket: 'cumulus-test-sandbox-private',
        checksum: 'bogus-value',
        checksumType: 'md5',
        fileName: 's3://cumulus-test-sandbox-private/firstKey',
        key: 'firstKey',
        size: 2098711627776,
        source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      },
      {
        bucket: 'cumulus-test-sandbox-private',
        checksum: 'bogus-value',
        checksumType: 'md5',
        fileName: 's3://cumulus-test-sandbox-private/secondKey',
        key: 'secondKey',
        size: 1099511627776,
        source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      },
    ],
  };

  const result = await translatePostgresGranuleToApiGranule({
    granulePgRecord: postgresGranule,
    knexOrTransaction: knex,
    collectionPgModel,
    pdrPgModel,
    providerPgModel,
    filePgModel,
  });

  t.deepEqual(
    result,
    expectedApiGranule
  );
});

test('translatePostgresGranuleToApiGranule accepts an optional Collection', async (t) => {
  const {
    knex,
    pdrPgModel,
    providerPgModel,
    collectionPgModel,
    filePgModel,
    granulePgModel,
    granuleCumulusId,
    executions,
  } = t.context;

  const postgresGranule = await granulePgModel.get(knex, { cumulus_id: granuleCumulusId });

  const expectedApiGranule = {
    beginningDateTime: postgresGranule.beginning_date_time.toISOString(),
    cmrLink: postgresGranule.cmr_link,
    collectionId: 'collectionName2___collectionVersion2',
    createdAt: postgresGranule.created_at.getTime(),
    duration: postgresGranule.duration,
    endingDateTime: postgresGranule.ending_date_time.toISOString(),
    error: postgresGranule.error,
    execution: getExecutionUrlFromArn(executions[0].arn),
    granuleId: postgresGranule.granule_id,
    lastUpdateDateTime: postgresGranule.last_update_date_time.toISOString(),
    pdrName: 'pdrName',
    processingEndDateTime: postgresGranule.processing_end_date_time.toISOString(),
    processingStartDateTime: postgresGranule.processing_start_date_time.toISOString(),
    productionDateTime: postgresGranule.production_date_time.toISOString(),
    productVolume: Number.parseInt(postgresGranule.product_volume, 10),
    provider: 'providerName',
    published: postgresGranule.published,
    queryFields: postgresGranule.query_fields,
    status: postgresGranule.status,
    timestamp: postgresGranule.timestamp.getTime(),
    timeToArchive: postgresGranule.time_to_archive,
    timeToPreprocess: postgresGranule.time_to_process,
    updatedAt: postgresGranule.updated_at.getTime(),
    files: [
      {
        bucket: 'cumulus-test-sandbox-private',
        checksum: 'bogus-value',
        checksumType: 'md5',
        fileName: 's3://cumulus-test-sandbox-private/firstKey',
        key: 'firstKey',
        size: 2098711627776,
        source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      },
      {
        bucket: 'cumulus-test-sandbox-private',
        checksum: 'bogus-value',
        checksumType: 'md5',
        fileName: 's3://cumulus-test-sandbox-private/secondKey',
        key: 'secondKey',
        size: 1099511627776,
        source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      },
    ],
  };

  // explicitly set the cumulus_id so that the collection matches the granule's
  // collection_cumulus_id. This is not in the database and will ensure that the
  // translate function below skips the DB query and uses this passed-in Collection.
  const collection = fakeCollectionRecordFactory({
    cumulus_id: 1,
    name: 'collectionName2',
    version: 'collectionVersion2',
  });

  const result = await translatePostgresGranuleToApiGranule({
    granulePgRecord: postgresGranule,
    collectionPgRecord: collection,
    knexOrTransaction: knex,
    collectionPgModel,
    pdrPgModel,
    providerPgModel,
    filePgModel,
  });

  t.deepEqual(
    result,
    expectedApiGranule
  );
});

test('translatePostgresGranuleToApiGranule throws an error if the Collection does not match', async (t) => {
  const {
    knex,
    pdrPgModel,
    providerPgModel,
    collectionPgModel,
    filePgModel,
    granulePgModel,
    granuleCumulusId,
  } = t.context;

  const postgresGranule = await granulePgModel.get(knex, { cumulus_id: granuleCumulusId });

  // No cumulus_id set so this will not match the granule's collection_cumulus_id
  const collection = fakeCollectionRecordFactory({
    name: 'collectionName2',
    version: 'collectionVersion2',
  });

  await t.throwsAsync(translatePostgresGranuleToApiGranule({
    granulePgRecord: postgresGranule,
    collectionPgRecord: collection,
    knexOrTransaction: knex,
    collectionPgModel,
    pdrPgModel,
    providerPgModel,
    filePgModel,
  }),
  { instanceOf: ValidationError });
});

test('translatePostgresGranuleToApiGranule does not require a PDR or Provider', async (t) => {
  const {
    knex,
    pdrPgModel,
    providerPgModel,
    collectionPgModel,
    filePgModel,
    granulePgModel,
    granuleCumulusId,
    executions,
  } = t.context;

  const postgresGranule = await granulePgModel.get(knex, { cumulus_id: granuleCumulusId });

  delete postgresGranule.pdr_cumulus_id;
  delete postgresGranule.provider_cumulus_id;

  const expectedApiGranule = {
    beginningDateTime: postgresGranule.beginning_date_time.toISOString(),
    cmrLink: postgresGranule.cmr_link,
    collectionId: 'collectionName___collectionVersion',
    createdAt: postgresGranule.created_at.getTime(),
    duration: postgresGranule.duration,
    endingDateTime: postgresGranule.ending_date_time.toISOString(),
    error: postgresGranule.error,
    execution: getExecutionUrlFromArn(executions[0].arn),
    granuleId: postgresGranule.granule_id,
    lastUpdateDateTime: postgresGranule.last_update_date_time.toISOString(),
    processingEndDateTime: postgresGranule.processing_end_date_time.toISOString(),
    processingStartDateTime: postgresGranule.processing_start_date_time.toISOString(),
    productionDateTime: postgresGranule.production_date_time.toISOString(),
    productVolume: Number.parseInt(postgresGranule.product_volume, 10),
    published: postgresGranule.published,
    queryFields: postgresGranule.query_fields,
    status: postgresGranule.status,
    timestamp: postgresGranule.timestamp.getTime(),
    timeToArchive: postgresGranule.time_to_archive,
    timeToPreprocess: postgresGranule.time_to_process,
    updatedAt: postgresGranule.updated_at.getTime(),
    files: [
      {
        bucket: 'cumulus-test-sandbox-private',
        checksum: 'bogus-value',
        checksumType: 'md5',
        fileName: 's3://cumulus-test-sandbox-private/firstKey',
        key: 'firstKey',
        size: 2098711627776,
        source: 's3://cumulus-test-sandbox-private/sourceDir/granule',

      },
      {
        bucket: 'cumulus-test-sandbox-private',
        checksum: 'bogus-value',
        checksumType: 'md5',
        fileName: 's3://cumulus-test-sandbox-private/secondKey',
        key: 'secondKey',
        size: 1099511627776,
        source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      },
    ],
  };

  const result = await translatePostgresGranuleToApiGranule({
    granulePgRecord: postgresGranule,
    knexOrTransaction: knex,
    collectionPgModel,
    pdrPgModel,
    providerPgModel,
    filePgModel,
  });

  t.deepEqual(
    result,
    expectedApiGranule
  );
});

test('translateApiGranuleToPostgresGranule converts API granule to Postgres', async (t) => {
  const collectionCumulusId = 1;
  const providerCumulusId = 2;
  const pdrCumulusId = 4;
  const dateString = new Date().toString();

  const apiGranule = {
    cmrLink: cryptoRandomString({ length: 10 }),
    collectionId: 'name___version',
    duration: 10,
    granuleId: cryptoRandomString({ length: 5 }),
    pdrName: 'pdr-name',
    provider: 'provider',
    published: false,
    status: 'running',
    files: [
      {
        bucket: 'null',
        key: 'null',
      },
    ],
    beginningDateTime: dateString,
    createdAt: Date.now() - 200 * 1000,
    endingDateTime: dateString,
    error: {},
    lastUpdateDateTime: dateString,
    processingEndDateTime: dateString,
    processingStartDateTime: dateString,
    productionDateTime: dateString,
    productVolume: 1119742,
    timestamp: Date.now(),
    timeToArchive: 0,
    timeToPreprocess: 0,
    updatedAt: Date.now(),
  };

  const fakeDbClient = {};
  const fakeCollectionPgModel = {
    getRecordCumulusId: () => Promise.resolve(collectionCumulusId),
  };
  const fakeProviderPgModel = {
    getRecordCumulusId: () => Promise.resolve(providerCumulusId),
  };
  const fakePdrPgModel = {
    getRecordCumulusId: () => Promise.resolve(pdrCumulusId),
  };

  const expectedPostgresGranule = {
    beginning_date_time: new Date(apiGranule.beginningDateTime),
    cmr_link: apiGranule.cmrLink,
    collection_cumulus_id: collectionCumulusId,
    created_at: new Date(apiGranule.createdAt),
    duration: apiGranule.duration,
    ending_date_time: new Date(apiGranule.endingDateTime),
    error: apiGranule.error,
    granule_id: apiGranule.granuleId,
    last_update_date_time: new Date(apiGranule.lastUpdateDateTime),
    pdr_cumulus_id: pdrCumulusId,
    processing_end_date_time: new Date(apiGranule.processingEndDateTime),
    processing_start_date_time: new Date(apiGranule.processingStartDateTime),
    product_volume: apiGranule.productVolume,
    production_date_time: new Date(apiGranule.productionDateTime),
    provider_cumulus_id: providerCumulusId,
    published: apiGranule.published,
    query_fields: apiGranule.query_fields,
    status: apiGranule.status,
    time_to_archive: apiGranule.timeToArchive,
    time_to_process: apiGranule.timeToPreprocess,
    timestamp: new Date(apiGranule.timestamp),
    updated_at: new Date(apiGranule.updatedAt),
  };

  const result = await translateApiGranuleToPostgresGranule(
    apiGranule,
    fakeDbClient,
    fakeCollectionPgModel,
    fakePdrPgModel,
    fakeProviderPgModel
  );

  t.deepEqual(
    result,
    expectedPostgresGranule
  );
});

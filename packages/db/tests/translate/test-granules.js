const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  generateLocalTestDb,
  FilePgModel,
  PdrPgModel,
  ProviderPgModel,
  CollectionPgModel,
  GranulePgModel,
  ExecutionPgModel,
  GranulesExecutionsPgModel,
  fakeCollectionRecordFactory,
  fakeProviderRecordFactory,
  fakePdrRecordFactory,
  fakeFileRecordFactory,
  fakeGranuleRecordFactory,
  fakeExecutionRecordFactory,
} = require('../../dist');

const {
  translateApiGranuleToPostgresGranule,
  translatePostgresGranuleToApiGranule,
} = require('../../dist/translate/granules');

const { migrationDir } = require('../../../../lambdas/db-migration/dist/lambda');

const testDbName = `granule_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  // Create collection
  t.context.collectionPgModel = new CollectionPgModel();
  const collection = fakeCollectionRecordFactory({ name: 'collectionName', version: 'collectionVersion' });
  const [collectionCumulusId] = await t.context.collectionPgModel.create(knex, collection);

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
      granule_id: cryptoRandomString({ length: 5 }),
      status: 'running',
      collection_cumulus_id: collectionCumulusId,
      published: false,
      duration: 10,
      time_to_archive: 0,
      time_to_process: 0,
      product_volume: 1119742,
      error: {},
      cmr_link: cryptoRandomString({ length: 10 }),
      pdr_cumulus_id: pdrCumulusId,
      provider_cumulus_id: providerCumulusId,
      beginning_date_time: new Date(Date.now() - 300 * 1000),
      ending_date_time: new Date(Date.now() - 250 * 1000),
      last_update_date_time: new Date(Date.now() - 100 * 1000),
      processing_end_date_time: new Date(Date.now() - 500 * 1000),
      processing_start_date_time: new Date(Date.now() - 400 * 1000),
      production_date_time: new Date(Date.now() - 350 * 1000),
      timestamp: new Date(Date.now() - 120 * 1000),
      created_at: new Date(Date.now() - 200 * 1000),
      updated_at: new Date(Date.now()),
      query_fields: { foo: 'bar' },
    })
  );

  // Create executions
  const executionPgModel = new ExecutionPgModel();
  const [executionACumulusId] = await executionPgModel.create(
    knex,
    fakeExecutionRecordFactory({ timestamp: new Date(Date.now()) })
  );
  const [executionBCumulusId] = await executionPgModel.create(
    knex,
    fakeExecutionRecordFactory({ timestamp: new Date(Date.now() - 200 * 1000) })
  );

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
      granule_cumulus_id: 1,
      bucket: 'cumulus-test-sandbox-private',
      key: 'firstKey',
      checksum_type: 'md5',
      checksum_value: 'bogus-value',
      file_name: 's3://cumulus-test-sandbox-private/firstKey',
      file_size: 100,
      path: 's3://cumulus-test-sandbox-private/sourceDir/firstKey',
      source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      created_at: new Date(Date.now()),
      updated_at: new Date(Date.now()),
    }),
    fakeFileRecordFactory({
      granule_cumulus_id: 1,
      bucket: 'cumulus-test-sandbox-private',
      key: 'secondKey',
      checksum_type: 'md5',
      checksum_value: 'bogus-value',
      file_name: 's3://cumulus-test-sandbox-private/secondKey',
      file_size: 200,
      path: 's3://cumulus-test-sandbox-private/sourceDir/secondKey',
      source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      created_at: new Date(Date.now()),
      updated_at: new Date(Date.now()),
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
    granuleId: postgresGranule.granule_id,
    collectionId: 'collectionName___collectionVersion',
    pdrName: 'pdrName',
    provider: 'providerName',
    status: postgresGranule.status,
    cmrLink: postgresGranule.cmr_link,
    published: postgresGranule.published,
    duration: postgresGranule.duration,
    files: [
      {
        bucket: 'cumulus-test-sandbox-private',
        key: 'firstKey',
        checksumType: 'md5',
        checksum: 'bogus-value',
        fileName: 's3://cumulus-test-sandbox-private/firstKey',
        size: 100,
        path: 's3://cumulus-test-sandbox-private/sourceDir/firstKey',
        source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      },
      {
        bucket: 'cumulus-test-sandbox-private',
        key: 'secondKey',
        checksumType: 'md5',
        checksum: 'bogus-value',
        fileName: 's3://cumulus-test-sandbox-private/secondKey',
        size: 200,
        path: 's3://cumulus-test-sandbox-private/sourceDir/secondKey',
        source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      },
    ],
    executions: executions.map((e) => e.arn),
    error: postgresGranule.error,
    queryFields: postgresGranule.query_fields,
    productVolume: postgresGranule.product_volume,
    timeToPreprocess: postgresGranule.time_to_process,
    beginningDateTime: postgresGranule.beginning_date_time.getTime(),
    endingDateTime: postgresGranule.ending_date_time.getTime(),
    processingStartDateTime: postgresGranule.processing_start_date_time.getTime(),
    processingEndDateTime: postgresGranule.processing_end_date_time.getTime(),
    lastUpdateDateTime: postgresGranule.last_update_date_time.getTime(),
    timeToArchive: postgresGranule.time_to_archive,
    productionDateTime: postgresGranule.production_date_time.getTime(),
    timestamp: postgresGranule.timestamp.getTime(),
    createdAt: postgresGranule.created_at.getTime(),
    updatedAt: postgresGranule.updated_at.getTime(),
  };

  const result = await translatePostgresGranuleToApiGranule(
    postgresGranule,
    knex,
    collectionPgModel,
    pdrPgModel,
    providerPgModel,
    filePgModel
  );

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
    granuleId: cryptoRandomString({ length: 5 }),
    collectionId: 'name___version',
    pdrName: 'pdr-name',
    provider: 'provider',
    status: 'running',
    cmrLink: cryptoRandomString({ length: 10 }),
    published: false,
    duration: 10,
    files: [
      {
        bucket: 'null',
        key: 'null',
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
    granule_id: apiGranule.granuleId,
    status: apiGranule.status,
    collection_cumulus_id: collectionCumulusId,
    published: apiGranule.published,
    duration: apiGranule.duration,
    time_to_archive: apiGranule.timeToArchive,
    time_to_process: apiGranule.timeToPreprocess,
    product_volume: apiGranule.productVolume,
    error: apiGranule.error,
    cmr_link: apiGranule.cmrLink,
    pdr_cumulus_id: pdrCumulusId,
    provider_cumulus_id: providerCumulusId,
    query_fields: apiGranule.query_fields,
    beginning_date_time: new Date(apiGranule.beginningDateTime),
    ending_date_time: new Date(apiGranule.endingDateTime),
    last_update_date_time: new Date(apiGranule.lastUpdateDateTime),
    processing_end_date_time: new Date(apiGranule.processingEndDateTime),
    processing_start_date_time: new Date(apiGranule.processingStartDateTime),
    production_date_time: new Date(apiGranule.productionDateTime),
    timestamp: new Date(apiGranule.timestamp),
    created_at: new Date(apiGranule.createdAt),
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

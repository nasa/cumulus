const orderBy = require('lodash/orderBy');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { ValidationError } = require('@cumulus/errors');
const { removeNilProperties } = require('@cumulus/common/util');
const { getExecutionUrlFromArn } = require('@cumulus/message/Executions');
const { constructCollectionId } = require('@cumulus/message/Collections');
const {
  translateApiGranuleToPostgresGranule,
  translateApiGranuleToPostgresGranuleWithoutNilsRemoved,
  translatePostgresGranuleToApiGranule,
} = require('../../dist/translate/granules');

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
  translatePostgresGranuleResultToApiGranule,
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
  t.context.collectionId = constructCollectionId(
    t.context.collection.name,
    t.context.collection.version
  );
  const [collectionPgRecord] = await t.context.collectionPgModel.create(
    knex,
    t.context.collection
  );
  const collectionCumulusId = collectionPgRecord.cumulus_id;
  t.context.collectionCumulusId = collectionCumulusId;

  // Create provider
  t.context.providerPgModel = new ProviderPgModel();
  const fakeProvider = fakeProviderRecordFactory({ name: 'providerName' });
  const [pgProvider] = await t.context.providerPgModel.create(knex, fakeProvider);
  t.context.providerCumulusId = pgProvider.cumulus_id;

  // Create PDR
  t.context.pdrPgModel = new PdrPgModel();
  const fakePdr = fakePdrRecordFactory({
    name: 'pdrName',
    collection_cumulus_id: collectionCumulusId,
    provider_cumulus_id: t.context.providerCumulusId,
  });
  const [pgPdr] = await t.context.pdrPgModel.create(knex, fakePdr);
  t.context.pdrCumulusId = pgPdr.cumulus_id;

  // Create Granule
  t.context.granulePgModel = new GranulePgModel();
  t.context.executionPgModel = new ExecutionPgModel();
  t.context.granulesExecutionsPgModel = new GranulesExecutionsPgModel();
});

test.beforeEach(async (t) => {
  [t.context.postgresGranule] = await t.context.granulePgModel.create(
    t.context.knex,
    fakeGranuleRecordFactory({
      beginning_date_time: new Date(Date.now() - 300 * 1000),
      cmr_link: cryptoRandomString({ length: 10 }),
      collection_cumulus_id: t.context.collectionCumulusId,
      created_at: new Date(Date.now() - 200 * 1000),
      duration: 10.1,
      ending_date_time: new Date(Date.now() - 250 * 1000),
      error: {},
      granule_id: cryptoRandomString({ length: 5 }),
      last_update_date_time: new Date(Date.now() - 100 * 1000),
      pdr_cumulus_id: t.context.pdrCumulusId,
      processing_end_date_time: new Date(Date.now() - 500 * 1000),
      processing_start_date_time: new Date(Date.now() - 400 * 1000),
      product_volume: 1119742,
      production_date_time: new Date(Date.now() - 350 * 1000),
      provider_cumulus_id: t.context.providerCumulusId,
      published: false,
      active_status: 'A',
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
    t.context.knex,
    fakeExecutionRecordFactory({ timestamp: new Date(Date.now()) })
  );
  const [executionB] = await executionPgModel.create(
    t.context.knex,
    fakeExecutionRecordFactory({ timestamp: new Date(Date.now() - 555 * 1000) })
  );

  const executionACumulusId = executionA.cumulus_id;
  const executionBCumulusId = executionB.cumulus_id;

  t.context.executions = [
    await executionPgModel.get(t.context.knex, { cumulus_id: executionACumulusId }),
    await executionPgModel.get(t.context.knex, { cumulus_id: executionBCumulusId }),
  ];

  t.context.granuleCumulusId = t.context.postgresGranule.cumulus_id;

  // Create GranulesExecutions JOIN records
  const granulesExecutionsPgModel = new GranulesExecutionsPgModel();
  await granulesExecutionsPgModel.create(
    t.context.knex,
    {
      granule_cumulus_id: t.context.granuleCumulusId,
      execution_cumulus_id: executionACumulusId,
    }
  );
  await granulesExecutionsPgModel.create(
    t.context.knex,
    {
      granule_cumulus_id: t.context.granuleCumulusId,
      execution_cumulus_id: executionBCumulusId,
    }
  );

  // Create files
  t.context.filePgModel = new FilePgModel();
  t.context.fileKeys = [
    `file0-${cryptoRandomString({ length: 10 })}`,
    `file1-${cryptoRandomString({ length: 10 })}`,
  ].sort();
  const files = [
    fakeFileRecordFactory({
      bucket: 'cumulus-test-sandbox-private',
      checksum_type: 'md5',
      checksum_value: 'bogus-value',
      created_at: createdAt,
      file_name: t.context.fileKeys[0],
      file_size: 2098711627776,
      granule_cumulus_id: t.context.granuleCumulusId,
      key: t.context.fileKeys[0],
      path: `sourceDir/${t.context.fileKeys[0]}`,
      source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      updated_at: updatedAt,
    }),
    fakeFileRecordFactory({
      bucket: 'cumulus-test-sandbox-private',
      checksum_type: 'md5',
      checksum_value: 'bogus-value',
      created_at: createdAt,
      file_name: t.context.fileKeys[1],
      file_size: 1099511627776,
      granule_cumulus_id: t.context.granuleCumulusId,
      key: t.context.fileKeys[1],
      path: `sourceDir/${t.context.fileKeys[1]}`,
      source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      updated_at: updatedAt,
    }),
  ];
  await Promise.all(files.map((file) => t.context.filePgModel.create(t.context.knex, file)));
});

test('translatePostgresGranuleToApiGranule converts Postgres granule to API granule', async (t) => {
  const {
    knex,
    pdrPgModel,
    providerPgModel,
    collectionPgModel,
    filePgModel,
    postgresGranule,
    fileKeys,
    executions,
  } = t.context;

  const expectedApiGranule = {
    activeStatus: 'A',
    archived: false,
    beginningDateTime: postgresGranule.beginning_date_time.toISOString(),
    cmrLink: postgresGranule.cmr_link,
    collectionId: constructCollectionId('collectionName', 'collectionVersion'),
    createdAt: postgresGranule.created_at.getTime(),
    duration: postgresGranule.duration,
    endingDateTime: postgresGranule.ending_date_time.toISOString(),
    error: postgresGranule.error,
    execution: executions[0].url,
    granuleId: postgresGranule.granule_id,
    lastUpdateDateTime: postgresGranule.last_update_date_time.toISOString(),
    pdrName: 'pdrName',
    processingEndDateTime: postgresGranule.processing_end_date_time.toISOString(),
    processingStartDateTime: postgresGranule.processing_start_date_time.toISOString(),
    producerGranuleId: postgresGranule.producer_granule_id,
    productionDateTime: postgresGranule.production_date_time.toISOString(),
    productVolume: postgresGranule.product_volume,
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
        fileName: fileKeys[0],
        key: fileKeys[0],
        size: 2098711627776,
        source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      },
      {
        bucket: 'cumulus-test-sandbox-private',
        checksum: 'bogus-value',
        checksumType: 'md5',
        fileName: fileKeys[1],
        key: fileKeys[1],
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
  result.files.sort((a, b) => (a.fileName > b.fileName ? 1 : -1));

  t.deepEqual(
    {
      ...result,
      files: orderBy(result.files, ['bucket', 'key']),
    },
    {
      ...expectedApiGranule,
      files: orderBy(expectedApiGranule.files, ['bucket', 'key']),
    }
  );
});

test('translatePostgresGranuleToApiGranule accepts an optional Collection', async (t) => {
  const {
    knex,
    pdrPgModel,
    providerPgModel,
    collectionPgModel,
    filePgModel,
    postgresGranule,
    fileKeys,
    executions,
  } = t.context;

  const expectedApiGranule = {
    activeStatus: 'A',
    archived: false,
    beginningDateTime: postgresGranule.beginning_date_time.toISOString(),
    cmrLink: postgresGranule.cmr_link,
    collectionId: constructCollectionId('collectionName2', 'collectionVersion2'),
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
    producerGranuleId: postgresGranule.producer_granule_id,
    productionDateTime: postgresGranule.production_date_time.toISOString(),
    productVolume: postgresGranule.product_volume,
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
        fileName: fileKeys[0],
        key: fileKeys[0],
        size: 2098711627776,
        source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      },
      {
        bucket: 'cumulus-test-sandbox-private',
        checksum: 'bogus-value',
        checksumType: 'md5',
        fileName: fileKeys[1],
        key: fileKeys[1],
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
  result.files.sort((a, b) => (a.fileName > b.fileName ? 1 : -1));

  t.deepEqual(
    {
      ...result,
      files: orderBy(result.files, ['bucket', 'key']),
    },
    {
      ...expectedApiGranule,
      files: orderBy(expectedApiGranule.files, ['bucket', 'key']),
    }
  );
});

test('translatePostgresGranuleToApiGranule accepts an optional provider', async (t) => {
  const {
    knex,
    pdrPgModel,
    providerPgModel,
    collectionPgModel,
    filePgModel,
    executions,
    postgresGranule,
    fileKeys,
    collectionId,
  } = t.context;

  const providerPgRecord = fakeProviderRecordFactory();
  const expectedApiGranule = {
    activeStatus: postgresGranule.active_status,
    archived: false,
    beginningDateTime: postgresGranule.beginning_date_time.toISOString(),
    cmrLink: postgresGranule.cmr_link,
    collectionId,
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
    producerGranuleId: postgresGranule.producer_granule_id,
    productionDateTime: postgresGranule.production_date_time.toISOString(),
    productVolume: postgresGranule.product_volume,
    provider: providerPgRecord.name,
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
        fileName: fileKeys[0],
        key: fileKeys[0],
        size: 2098711627776,
        source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      },
      {
        bucket: 'cumulus-test-sandbox-private',
        checksum: 'bogus-value',
        checksumType: 'md5',
        fileName: fileKeys[1],
        key: fileKeys[1],
        size: 1099511627776,
        source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      },
    ],
  };

  const result = await translatePostgresGranuleToApiGranule({
    granulePgRecord: postgresGranule,
    providerPgRecord,
    knexOrTransaction: knex,
    collectionPgModel,
    pdrPgModel,
    providerPgModel,
    filePgModel,
  });
  result.files.sort((a, b) => (a.fileName > b.fileName ? 1 : -1));

  t.deepEqual(
    {
      ...result,
      files: orderBy(result.files, ['bucket', 'key']),
    },
    expectedApiGranule
  );
});

test('translatePostgresGranuleToApiGranule returns an empty array for its files property if there are no PostgreSQL files', async (t) => {
  const {
    knex,
    pdrPgModel,
    providerPgModel,
    collectionPgModel,
    filePgModel,
    collectionCumulusId,
    collectionId,
  } = t.context;

  const [pgGranule] = await t.context.granulePgModel.create(
    knex,
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      active_status: 'A',
    }),
    '*'
  );

  const expectedApiGranule = {
    archived: false,
    collectionId,
    createdAt: pgGranule.created_at.getTime(),
    granuleId: pgGranule.granule_id,
    producerGranuleId: pgGranule.producer_granule_id,
    status: pgGranule.status,
    updatedAt: pgGranule.updated_at.getTime(),
    activeStatus: pgGranule.active_status,
    files: [],
  };

  const result = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
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
    executions,
    postgresGranule,
    fileKeys,
  } = t.context;

  delete postgresGranule.pdr_cumulus_id;
  delete postgresGranule.provider_cumulus_id;

  const expectedApiGranule = {
    activeStatus: 'A',
    archived: false,
    beginningDateTime: postgresGranule.beginning_date_time.toISOString(),
    cmrLink: postgresGranule.cmr_link,
    collectionId: constructCollectionId('collectionName', 'collectionVersion'),
    createdAt: postgresGranule.created_at.getTime(),
    duration: postgresGranule.duration,
    endingDateTime: postgresGranule.ending_date_time.toISOString(),
    error: postgresGranule.error,
    execution: getExecutionUrlFromArn(executions[0].arn),
    granuleId: postgresGranule.granule_id,
    lastUpdateDateTime: postgresGranule.last_update_date_time.toISOString(),
    processingEndDateTime: postgresGranule.processing_end_date_time.toISOString(),
    processingStartDateTime: postgresGranule.processing_start_date_time.toISOString(),
    producerGranuleId: postgresGranule.producer_granule_id,
    productionDateTime: postgresGranule.production_date_time.toISOString(),
    productVolume: postgresGranule.product_volume,
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
        fileName: fileKeys[0],
        key: fileKeys[0],
        size: 2098711627776,
        source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      },
      {
        bucket: 'cumulus-test-sandbox-private',
        checksum: 'bogus-value',
        checksumType: 'md5',
        fileName: fileKeys[1],
        key: fileKeys[1],
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
  result.files.sort((a, b) => (a.fileName > b.fileName ? 1 : -1));

  t.deepEqual(
    {
      ...result,
      files: orderBy(result.files, ['bucket', 'key']),
    },
    {
      ...expectedApiGranule,
      files: orderBy(expectedApiGranule.files, ['bucket', 'key']),
    }
  );
});

test('translatePostgresGranuleToApiGranule handles granule with no associated execution', async (t) => {
  const {
    knex,
    collectionCumulusId,
    granulePgModel,
    collectionId,
  } = t.context;

  const [granule] = await granulePgModel.create(
    knex,
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
    }),
    '*'
  );

  const expectedApiGranule = {
    granuleId: granule.granule_id,
    status: granule.status,
    createdAt: granule.created_at.getTime(),
    collectionId,
  };

  const result = await translatePostgresGranuleToApiGranule({
    granulePgRecord: granule,
    knexOrTransaction: knex,
  });

  t.like(
    result,
    expectedApiGranule
  );
});

test('translateApiGranuleToPostgresGranuleWithoutNilsRemoved converts API granule to Postgres', async (t) => {
  const collectionCumulusId = 1;
  const providerCumulusId = 2;
  const pdrCumulusId = 4;
  const dateString = new Date().toString();

  const apiGranule = {
    archived: true,
    cmrLink: cryptoRandomString({ length: 10 }),
    duration: 10,
    granuleId: cryptoRandomString({ length: 5 }),
    collectionId: constructCollectionId('name', 'version'),
    pdrName: 'pdr-name',
    producerGranuleId: cryptoRandomString({ length: 5 }),
    provider: 'provider',
    published: false,
    queryFields: {
      foo: cryptoRandomString({ length: 8 }),
    },
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
    productVolume: '1119742',
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
    archived: true,
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
    producer_granule_id: apiGranule.producerGranuleId,
    product_volume: apiGranule.productVolume,
    production_date_time: new Date(apiGranule.productionDateTime),
    provider_cumulus_id: providerCumulusId,
    published: apiGranule.published,
    query_fields: apiGranule.queryFields,
    status: apiGranule.status,
    time_to_archive: apiGranule.timeToArchive,
    time_to_process: apiGranule.timeToPreprocess,
    timestamp: new Date(apiGranule.timestamp),
    updated_at: new Date(apiGranule.updatedAt),
    active_status: apiGranule.activeStatus,
  };

  const result = await translateApiGranuleToPostgresGranuleWithoutNilsRemoved({
    dynamoRecord: apiGranule,
    knexOrTransaction: fakeDbClient,
    collectionPgModel: fakeCollectionPgModel,
    pdrPgModel: fakePdrPgModel,
    providerPgModel: fakeProviderPgModel,
  });

  t.deepEqual(
    result,
    expectedPostgresGranule
  );
});

test('translateApiGranuleToPostgresGranuleWithoutNilsRemoved does not remove null/undefined fields', async (t) => {
  const collectionCumulusId = 1;
  const providerCumulusId = 2;
  const pdrCumulusId = 4;
  const dateString = new Date().toString();

  const apiGranule = {
    cmrLink: cryptoRandomString({ length: 10 }),
    duration: 10,
    granuleId: cryptoRandomString({ length: 5 }),
    collectionId: constructCollectionId('name', 'version'),
    pdrName: 'pdr-name',
    producerGranuleId: cryptoRandomString({ length: 5 }),
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
    timestamp: Date.now(),
    timeToArchive: 0,
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
    active_status: apiGranule.activeStatus,
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
    producer_granule_id: apiGranule.producerGranuleId,
    product_volume: undefined, // Undefined on apiGranule
    production_date_time: new Date(apiGranule.productionDateTime),
    provider_cumulus_id: providerCumulusId,
    published: apiGranule.published,
    query_fields: undefined, // Undefined on apiGranule
    status: apiGranule.status,
    time_to_archive: apiGranule.timeToArchive,
    time_to_process: undefined, // Undefined on apiGranule
    timestamp: new Date(apiGranule.timestamp),
    updated_at: new Date(apiGranule.updatedAt),
    archived: undefined,
  };

  const result = await translateApiGranuleToPostgresGranuleWithoutNilsRemoved({
    dynamoRecord: apiGranule,
    knexOrTransaction: fakeDbClient,
    collectionPgModel: fakeCollectionPgModel,
    pdrPgModel: fakePdrPgModel,
    providerPgModel: fakeProviderPgModel,
  });

  t.deepEqual(
    result,
    expectedPostgresGranule
  );
});

test.serial('translateApiGranuleToPostgresGranuleWithoutNilsRemoved throws on inappropriate nullification of collectionId', async (t) => {
  const collectionCumulusId = 1;
  const providerCumulusId = 2;
  const pdrCumulusId = 4;
  const granuleStatus = 'complete';

  const fakeCollectionPgModel = {
    getRecordCumulusId: () => Promise.resolve(collectionCumulusId),
  };
  const fakeProviderPgModel = {
    getRecordCumulusId: () => Promise.resolve(providerCumulusId),
  };
  const fakePdrPgModel = {
    getRecordCumulusId: () => Promise.resolve(pdrCumulusId),
  };

  const apiGranule = {
    granuleId: cryptoRandomString({ length: 5 }),
    collectionId: null,
    status: granuleStatus,
  };

  await t.throwsAsync(translateApiGranuleToPostgresGranuleWithoutNilsRemoved({
    dynamoRecord: apiGranule,
    knexOrTransaction: {},
    collectionPgModel: fakeCollectionPgModel,
    pdrPgModel: fakePdrPgModel,
    providerPgModel: fakeProviderPgModel,
  }), { instanceOf: ValidationError });
});

test.serial('translateApiGranuleToPostgresGranuleWithoutNilsRemoved throws on inappropriate nullification of granuleId', async (t) => {
  const collectionCumulusId = 1;
  const providerCumulusId = 2;
  const pdrCumulusId = 4;
  const granuleStatus = 'complete';

  const fakeCollectionPgModel = {
    getRecordCumulusId: () => Promise.resolve(collectionCumulusId),
  };
  const fakeProviderPgModel = {
    getRecordCumulusId: () => Promise.resolve(providerCumulusId),
  };
  const fakePdrPgModel = {
    getRecordCumulusId: () => Promise.resolve(pdrCumulusId),
  };

  const apiGranule = {
    granuleId: null,
    collectionId: collectionCumulusId,
    status: granuleStatus,
  };

  await t.throwsAsync(translateApiGranuleToPostgresGranuleWithoutNilsRemoved({
    dynamoRecord: apiGranule,
    knexOrTransaction: {},
    collectionPgModel: fakeCollectionPgModel,
    pdrPgModel: fakePdrPgModel,
    providerPgModel: fakeProviderPgModel,
  }), { instanceOf: ValidationError });
});

test.serial('translateApiGranuleToPostgresGranuleWithoutNilsRemoved throws on inappropriate nullification of status', async (t) => {
  const collectionCumulusId = 1;
  const providerCumulusId = 2;
  const pdrCumulusId = 4;

  const fakeCollectionPgModel = {
    getRecordCumulusId: () => Promise.resolve(collectionCumulusId),
  };
  const fakeProviderPgModel = {
    getRecordCumulusId: () => Promise.resolve(providerCumulusId),
  };
  const fakePdrPgModel = {
    getRecordCumulusId: () => Promise.resolve(pdrCumulusId),
  };

  const apiGranule = {
    granuleId: cryptoRandomString({ length: 5 }),
    collectionId: collectionCumulusId,
    status: null,
  };

  await t.throwsAsync(translateApiGranuleToPostgresGranuleWithoutNilsRemoved({
    dynamoRecord: apiGranule,
    knexOrTransaction: {},
    collectionPgModel: fakeCollectionPgModel,
    pdrPgModel: fakePdrPgModel,
    providerPgModel: fakeProviderPgModel,
  }), { instanceOf: ValidationError });
});

test.serial('translateApiGranuleToPostgresGranuleWithoutNilsRemoved converts API granule to Postgres, preserving null values', async (t) => {
  const collectionCumulusId = 1;
  const providerCumulusId = 2;
  const pdrCumulusId = 4;
  const granuleStatus = 'complete';
  const fakeCollectionPgModel = {
    getRecordCumulusId: () => Promise.resolve(collectionCumulusId),
  };
  const fakeProviderPgModel = {
    getRecordCumulusId: () => Promise.resolve(providerCumulusId),
  };
  const fakePdrPgModel = {
    getRecordCumulusId: () => Promise.resolve(pdrCumulusId),
  };

  const apiGranule = {
    archived: false,
    granuleId: cryptoRandomString({ length: 5 }),
    collectionId: constructCollectionId('name', 'version'),
    producerGranuleId: cryptoRandomString({ length: 5 }),
    activeStatus: 'H',
    status: granuleStatus,
    cmrLink: null,
    duration: null,
    pdrName: null,
    provider: null,
    published: null,
    queryFields: null,
    beginningDateTime: null,
    createdAt: null,
    endingDateTime: null,
    error: null,
    lastUpdateDateTime: null,
    processingEndDateTime: null,
    processingStartDateTime: null,
    productionDateTime: null,
    productVolume: null,
    timestamp: null,
    timeToArchive: null,
    timeToPreprocess: null,
    updatedAt: null,
  };

  const expectedPostgresGranule = {
    archived: false,
    active_status: 'H',
    granule_id: apiGranule.granuleId,
    collection_cumulus_id: collectionCumulusId,
    producer_granule_id: apiGranule.producerGranuleId,
    status: granuleStatus,
    beginning_date_time: null,
    cmr_link: null,
    created_at: null,
    duration: null,
    ending_date_time: null,
    error: null,
    last_update_date_time: null,
    pdr_cumulus_id: null,
    processing_end_date_time: null,
    processing_start_date_time: null,
    product_volume: null,
    production_date_time: null,
    provider_cumulus_id: null,
    published: null,
    query_fields: null,
    time_to_archive: null,
    time_to_process: null,
    timestamp: null,
    updated_at: null,
  };

  const result = await translateApiGranuleToPostgresGranuleWithoutNilsRemoved({
    dynamoRecord: apiGranule,
    knexOrTransaction: {},
    collectionPgModel: fakeCollectionPgModel,
    pdrPgModel: fakePdrPgModel,
    providerPgModel: fakeProviderPgModel,
  });

  t.deepEqual(
    result,
    expectedPostgresGranule
  );
});

test.serial('translateApiGranuleToPostgresGranuleWithoutNilsRemoved converts API granule to Postgres, with undefined values set', async (t) => {
  const collectionCumulusId = 1;
  const providerCumulusId = 2;
  const pdrCumulusId = 4;
  const granuleStatus = 'complete';
  const fakeCollectionPgModel = {
    getRecordCumulusId: () => Promise.resolve(collectionCumulusId),
  };
  const fakeProviderPgModel = {
    getRecordCumulusId: () => Promise.resolve(providerCumulusId),
  };
  const fakePdrPgModel = {
    getRecordCumulusId: () => Promise.resolve(pdrCumulusId),
  };

  const apiGranule = {
    granuleId: cryptoRandomString({ length: 5 }),
    collectionId: constructCollectionId('name', 'version'),
    producerGranuleId: cryptoRandomString({ length: 5 }),
    status: granuleStatus,
    activeStatus: 'H',
  };

  const expectedPostgresGranule = {
    archived: undefined,
    status: granuleStatus,
    collection_cumulus_id: collectionCumulusId,
    granule_id: apiGranule.granuleId,
    producer_granule_id: apiGranule.producerGranuleId,
    active_status: 'H',
    beginning_date_time: undefined,
    cmr_link: undefined,
    created_at: undefined,
    duration: undefined,
    ending_date_time: undefined,
    error: undefined,
    last_update_date_time: undefined,
    pdr_cumulus_id: undefined,
    processing_end_date_time: undefined,
    processing_start_date_time: undefined,
    product_volume: undefined,
    production_date_time: undefined,
    provider_cumulus_id: undefined,
    published: undefined,
    query_fields: undefined,
    time_to_archive: undefined,
    time_to_process: undefined,
    timestamp: undefined,
    updated_at: undefined,
  };

  const result = await translateApiGranuleToPostgresGranuleWithoutNilsRemoved({
    dynamoRecord: apiGranule,
    knexOrTransaction: {},
    collectionPgModel: fakeCollectionPgModel,
    pdrPgModel: fakePdrPgModel,
    providerPgModel: fakeProviderPgModel,
  });

  t.deepEqual(
    result,
    expectedPostgresGranule
  );
});

test.serial('translateApiGranuleToPostgresGranule converts API granule to Postgres, removing null values', async (t) => {
  const collectionCumulusId = 1;
  const providerCumulusId = 2;
  const pdrCumulusId = 4;
  const granuleStatus = 'complete';
  const fakeCollectionPgModel = {
    getRecordCumulusId: () => Promise.resolve(collectionCumulusId),
  };
  const fakeProviderPgModel = {
    getRecordCumulusId: () => Promise.resolve(providerCumulusId),
  };
  const fakePdrPgModel = {
    getRecordCumulusId: () => Promise.resolve(pdrCumulusId),
  };

  const apiGranule = {
    granuleId: cryptoRandomString({ length: 5 }),
    producerGranuleId: cryptoRandomString({ length: 5 }),
    collectionId: constructCollectionId('name', 'version'),
    status: granuleStatus,
    cmrLink: null,
    duration: null,
    pdrName: null,
    provider: null,
    published: null,
    queryFields: null,
    beginningDateTime: null,
    createdAt: null,
    endingDateTime: null,
    error: null,
    lastUpdateDateTime: null,
    processingEndDateTime: null,
    processingStartDateTime: null,
    productionDateTime: null,
    productVolume: null,
    timestamp: null,
    timeToArchive: null,
    timeToPreprocess: null,
    updatedAt: null,
  };

  const expectedPostgresGranule = {
    granule_id: apiGranule.granuleId,
    collection_cumulus_id: collectionCumulusId,
    producer_granule_id: apiGranule.producerGranuleId,
    status: granuleStatus,
  };

  const result = await translateApiGranuleToPostgresGranule({
    dynamoRecord: apiGranule,
    knexOrTransaction: {},
    collectionPgModel: fakeCollectionPgModel,
    pdrPgModel: fakePdrPgModel,
    providerPgModel: fakeProviderPgModel,
  });

  t.deepEqual(
    result,
    expectedPostgresGranule
  );
});

test('translateApiGranuleToPostgresGranule converts API granule to Postgres', async (t) => {
  const collectionCumulusId = 1;
  const providerCumulusId = 2;
  const pdrCumulusId = 4;
  const dateString = new Date().toString();

  const apiGranule = {
    cmrLink: cryptoRandomString({ length: 10 }),
    duration: 10,
    granuleId: cryptoRandomString({ length: 5 }),
    collectionId: constructCollectionId('name', 'version'),
    pdrName: 'pdr-name',
    producerGranuleId: cryptoRandomString({ length: 5 }),
    provider: 'provider',
    published: false,
    queryFields: {
      foo: cryptoRandomString({ length: 8 }),
    },
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
    productVolume: '1119742',
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
    producer_granule_id: apiGranule.producerGranuleId,
    product_volume: apiGranule.productVolume,
    production_date_time: new Date(apiGranule.productionDateTime),
    provider_cumulus_id: providerCumulusId,
    published: apiGranule.published,
    query_fields: apiGranule.queryFields,
    status: apiGranule.status,
    time_to_archive: apiGranule.timeToArchive,
    time_to_process: apiGranule.timeToPreprocess,
    timestamp: new Date(apiGranule.timestamp),
    updated_at: new Date(apiGranule.updatedAt),
  };

  const result = await translateApiGranuleToPostgresGranule({
    dynamoRecord: apiGranule,
    knexOrTransaction: fakeDbClient,
    collectionPgModel: fakeCollectionPgModel,
    pdrPgModel: fakePdrPgModel,
    providerPgModel: fakeProviderPgModel,
  });

  t.deepEqual(
    result,
    expectedPostgresGranule
  );
});

test('translateApiGranuleToPostgresGranule removes null/undefined fields', async (t) => {
  const collectionCumulusId = 1;
  const providerCumulusId = 2;
  const pdrCumulusId = 4;
  const dateString = new Date().toString();

  const apiGranule = {
    cmrLink: cryptoRandomString({ length: 10 }),
    duration: 10,
    granuleId: cryptoRandomString({ length: 5 }),
    collectionId: constructCollectionId('name', 'version'),
    pdrName: 'pdr-name',
    producerGranuleId: cryptoRandomString({ length: 5 }),
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
    timestamp: Date.now(),
    timeToArchive: 0,
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
    producer_granule_id: apiGranule.producerGranuleId,
    product_volume: undefined, // Undefined on apiGranule
    production_date_time: new Date(apiGranule.productionDateTime),
    provider_cumulus_id: providerCumulusId,
    published: apiGranule.published,
    query_fields: undefined, // Undefined on apiGranule
    status: apiGranule.status,
    time_to_archive: apiGranule.timeToArchive,
    time_to_process: undefined, // Undefined on apiGranule
    timestamp: new Date(apiGranule.timestamp),
    updated_at: new Date(apiGranule.updatedAt),
  };

  const result = await translateApiGranuleToPostgresGranule({
    dynamoRecord: apiGranule,
    knexOrTransaction: fakeDbClient,
    collectionPgModel: fakeCollectionPgModel,
    pdrPgModel: fakePdrPgModel,
    providerPgModel: fakeProviderPgModel,
  });

  t.deepEqual(
    result,
    removeNilProperties(expectedPostgresGranule)
  );
});

test('translatePostgresGranuleResultToApiGranule converts DB result to API granule', async (t) => {
  const {
    postgresGranule,
    fileKeys,
    executions,
    knex,
  } = t.context;

  const collectionName = cryptoRandomString({ length: 10 });
  const collectionVersion = '0.0.0';
  const providerName = cryptoRandomString({ length: 10 });

  const dbResult = {
    ...postgresGranule,
    collectionName,
    collectionVersion,
    providerName,
  };

  const expectedApiGranule = {
    activeStatus: 'A',
    archived: false,
    beginningDateTime: postgresGranule.beginning_date_time.toISOString(),
    cmrLink: postgresGranule.cmr_link,
    collectionId: constructCollectionId(collectionName, collectionVersion),
    createdAt: postgresGranule.created_at.getTime(),
    duration: postgresGranule.duration,
    endingDateTime: postgresGranule.ending_date_time.toISOString(),
    error: postgresGranule.error,
    execution: executions[0].url,
    granuleId: postgresGranule.granule_id,
    lastUpdateDateTime: postgresGranule.last_update_date_time.toISOString(),
    pdrName: 'pdrName',
    processingEndDateTime: postgresGranule.processing_end_date_time.toISOString(),
    processingStartDateTime: postgresGranule.processing_start_date_time.toISOString(),
    producerGranuleId: postgresGranule.producer_granule_id,
    productionDateTime: postgresGranule.production_date_time.toISOString(),
    productVolume: postgresGranule.product_volume,
    provider: providerName,
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
        fileName: fileKeys[0],
        key: fileKeys[0],
        size: 2098711627776,
        source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      },
      {
        bucket: 'cumulus-test-sandbox-private',
        checksum: 'bogus-value',
        checksumType: 'md5',
        fileName: fileKeys[1],
        key: fileKeys[1],
        size: 1099511627776,
        source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      },
    ],
  };

  const result = await translatePostgresGranuleResultToApiGranule(
    knex,
    dbResult
  );
  result.files.sort((a, b) => (a.fileName > b.fileName ? 1 : -1));

  t.deepEqual(
    {
      ...result,
      files: orderBy(result.files, ['bucket', 'key']),
    },
    expectedApiGranule
  );
});

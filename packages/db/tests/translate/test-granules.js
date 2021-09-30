const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const { ValidationError } = require('@cumulus/errors');
const {
  translateApiGranuleToPostgresGranule,
  translatePostgresGranuleToApiGranule,
} = require('../../dist/translate/granules');
const { getExecutionUrlFromArn } = require('@cumulus/message/Executions');
const {
  fakeCollectionRecordFactory,
} = require('../../dist');

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

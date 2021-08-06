const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  translateApiGranuleToPostgresGranule,
  translatePostgresGranuleToApiGranule,
} = require('../../dist/translate/granules');

test('translatePostgresGranuleToApiGranule converts Postgres granule to API granule', async (t) => {
  const collectionCumulusId = 1;
  const providerCumulusId = 2;
  const pdrCumulusId = 4;

  const postgresFiles = [
    {
      bucket: 'cumulus-test-sandbox-private',
      key: 'firstKey',
      checksum_type: 'md5',
      checksum_value: 'bogus-value',
      file_name: 's3://cumulus-test-sandbox-private/firstKey',
      file_size: 100,
      path: 's3://cumulus-test-sandbox-private/sourceDir/firstKey',
      source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      created_at: new Date(Date.now() - 200 * 1000),
      updated_at: new Date(Date.now()),
    },
    {
      bucket: 'cumulus-test-sandbox-private',
      key: 'secondKey',
      checksum_type: 'md5',
      checksum_value: 'bogus-value',
      file_name: 's3://cumulus-test-sandbox-private/secondKey',
      file_size: 200,
      path: 's3://cumulus-test-sandbox-private/sourceDir/secondKey',
      source: 's3://cumulus-test-sandbox-private/sourceDir/granule',
      created_at: new Date(Date.now() - 200 * 1000),
      updated_at: new Date(Date.now()),
    },
  ];

  const postgresGranule = {
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
    files: postgresFiles,
  };

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

  const fakeDbClient = {};
  const fakeCollectionPgModel = {
    get: () => Promise.resolve({ name: 'collectionName', version: 'collectionVersion' }),
  };
  const fakeProviderPgModel = {
    get: () => Promise.resolve({ name: 'providerName' }),
  };
  const fakePdrPgModel = {
    get: () => Promise.resolve({ name: 'pdrName' }),
  };
  const fakeFilePgModel = {
    search: () => Promise.resolve([
      {
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
      },
      {
        granule_cumulus_id: 2,
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
      },
    ]),
  };

  const result = await translatePostgresGranuleToApiGranule(
    postgresGranule,
    fakeDbClient,
    fakeCollectionPgModel,
    fakePdrPgModel,
    fakeProviderPgModel,
    fakeFilePgModel
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

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { translateApiGranuleToPostgresGranule } = require('../../dist/translate/granules');

test('translatePostgresGranuleToApiGranule converts Postgres granule to API granule', async (t) => {
  const collectionCumulusId = 1;
  const providerCumulusId = 2;
  const pdrCumulusId = 4;
  const dateString = new Date().toString();

  const postgresGranule = {
    granule_id: cryptoRandomString({ length: 5 }),
    status: 'running',
    collection_cumulus_id: collectionCumulusId,
    published: false,
    duration: 10,
    time_to_archive: apiGranule.timeToArchive,
    time_to_process: 0,
    product_volume: 1119742,
    error: apiGranule.error,
    cmr_link: cryptoRandomString({ length: 10 }),
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
    files: , // TODO
  };

  const expectedApiGranule = {
    granuleId: postgresGranule.granule_id,
    collectionId: 'name___version',
    pdrName: 'pdr-name',
    provider: 'provider',
    status: postgresGranule.status,
    cmrLink: postgresGranule.cmr_link,
    published: postgresGranule.published,
    duration: postgresGranule.duration,
    files: [
      // TODO
    ],
    error: {},
    productVolume: postgresGranule.product_volume,
    timeToPreprocess: postgresGranule.time_to_process,
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

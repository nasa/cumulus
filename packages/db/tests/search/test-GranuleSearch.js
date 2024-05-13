const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');

const { constructCollectionId } = require('@cumulus/message/Collections');

const {
  CollectionPgModel,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  fakePdrRecordFactory,
  fakeProviderRecordFactory,
  generateLocalTestDb,
  GranulePgModel,
  GranuleSearch,
  PdrPgModel,
  ProviderPgModel,
  migrationDir,
} = require('../../dist');

const testDbName = `granule_${cryptoRandomString({ length: 10 })}`;

// generate granuleId for infix and prefix search
const generateGranuleId = (num) => {
  let granuleId = cryptoRandomString({ length: 10 });
  if (num % 30 === 0) granuleId = `${cryptoRandomString({ length: 5 })}infix${cryptoRandomString({ length: 5 })}`;
  if (num % 50 === 0) granuleId = `prefix${cryptoRandomString({ length: 10 })}`;
  return granuleId;
};

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  // Create collection
  t.context.collectionPgModel = new CollectionPgModel();
  t.context.collectionName = 'fakeCollection';
  t.context.collectionVersion = 'v1';

  const collectionName2 = 'fakeCollection2';
  const collectionVersion2 = 'v2';

  t.context.collectionId = constructCollectionId(
    t.context.collectionName,
    t.context.collectionVersion
  );

  t.context.collectionId2 = constructCollectionId(
    collectionName2,
    collectionVersion2
  );

  t.context.testPgCollection = fakeCollectionRecordFactory({
    name: t.context.collectionName,
    version: t.context.collectionVersion,
  });
  t.context.testPgCollection2 = fakeCollectionRecordFactory({
    name: collectionName2,
    version: collectionVersion2,
  });

  const [pgCollection] = await t.context.collectionPgModel.create(
    t.context.knex,
    t.context.testPgCollection
  );
  const [pgCollection2] = await t.context.collectionPgModel.create(
    t.context.knex,
    t.context.testPgCollection2
  );
  t.context.collectionCumulusId = pgCollection.cumulus_id;
  t.context.collectionCumulusId2 = pgCollection2.cumulus_id;

  // Create provider
  t.context.providerPgModel = new ProviderPgModel();
  t.context.provider = fakeProviderRecordFactory();

  const [pgProvider] = await t.context.providerPgModel.create(
    t.context.knex,
    t.context.provider
  );
  t.context.providerCumulusId = pgProvider.cumulus_id;

  // Create PDR
  t.context.pdrPgModel = new PdrPgModel();
  t.context.pdr = fakePdrRecordFactory({
    collection_cumulus_id: pgCollection.cumulus_id,
    provider_cumulus_id: t.context.providerCumulusId,
  });
  const [pgPdr] = await t.context.pdrPgModel.create(
    t.context.knex,
    t.context.pdr
  );
  t.context.pdrCumulusId = pgPdr.cumulus_id;

  // Create Granule
  t.context.granuleSearchFields = {
    beginningDateTime: '2020-03-16T19:50:24.757Z',
    cmrLink: 'https://fakeLink',
    duration: '6.8',
    endingDateTime: '2020-03-17T10:00:00.000Z',
    lastUpdateDateTime: '2020-03-18T10:00:00.000Z',
    processingEndDateTime: '2020-03-16T10:00:00.000Z',
    productVolume: '600',
    timeToArchive: '700.29',
    timeToPreprocess: '800.18',
    status: 'failed',
    timestamp: 1579352700000,
    updatedAt: new Date(1579352700000).toISOString(),
  };

  const error = {
    Cause: 'cause string',
    Error: 'CumulusMessageAdapterExecutionError',
  };

  t.context.granulePgModel = new GranulePgModel();
  t.context.pgGranules = await t.context.granulePgModel.insert(
    knex,
    range(100).map((num) => fakeGranuleRecordFactory({
      granule_id: generateGranuleId(num),
      collection_cumulus_id: (num % 2)
        ? t.context.collectionCumulusId : t.context.collectionCumulusId2,
      pdr_cumulus_id: !(num % 2) ? t.context.pdrCumulusId : undefined,
      provider_cumulus_id: !(num % 2) ? t.context.providerCumulusId : undefined,
      beginning_date_time: !(num % 2)
        ? new Date(t.context.granuleSearchFields.beginningDateTime) : undefined,
      cmr_link: !(num % 100) ? t.context.granuleSearchFields.cmrLink : undefined,
      duration: !(num % 2) ? Number(t.context.granuleSearchFields.duration) : undefined,
      ending_date_time: !(num % 2)
        ? new Date(t.context.granuleSearchFields.endingDateTime) : new Date(),
      error: !(num % 2) ? JSON.stringify(error) : undefined,
      last_update_date_time: !(num % 2)
        ? t.context.granuleSearchFields.lastUpdateDateTime : undefined,
      published: !!(num % 2),
      product_volume: !(num % 5) ? Number(t.context.granuleSearchFields.productVolume) : undefined,
      time_to_archive: !(num % 10)
        ? Number(t.context.granuleSearchFields.timeToArchive) : undefined,
      time_to_process: !(num % 20)
        ? Number(t.context.granuleSearchFields.timeToPreprocess) : undefined,
      status: !(num % 2) ? t.context.granuleSearchFields.status : 'completed',
      updated_at: !(num % 2) ? new Date(t.context.granuleSearchFields.timestamp) : undefined,
    }))
  );
});

test('GranuleSearch returns 10 granule records by default', async (t) => {
  const { knex } = t.context;
  const dbSearch = new GranuleSearch();
  const response = await dbSearch.query(knex);

  t.is(response.meta.count, 100);

  const apiGranules = response.results || {};
  t.is(apiGranules.length, 10);
  const validatedRecords = apiGranules.filter((granule) => (
    [t.context.collectionId, t.context.collectionId2].includes(granule.collectionId)
    && (!granule.provider || granule.provider === t.context.provider.name)
    && (!granule.pdrName || granule.pdrName === t.context.pdr.name)));
  t.is(validatedRecords.length, apiGranules.length);
});

test('GranuleSearch supports page and limit params', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 20,
    page: 2,
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 20);

  queryStringParameters = {
    limit: 11,
    page: 10,
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 1);

  queryStringParameters = {
    limit: 10,
    page: 11,
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 0);
});

test('GranuleSearch supports infix search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    infix: 'infix',
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 3);
  t.is(response.results?.length, 3);
});

test('GranuleSearch supports prefix search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    prefix: 'prefix',
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 2);
  t.is(response.results?.length, 2);
});

test('GranuleSearch supports collectionId term search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    collectionId: t.context.collectionId2,
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports provider term search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    provider: t.context.provider.name,
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports pdrName term search', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    pdrName: t.context.pdr.name,
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports term search for boolean field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    published: 'true',
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports term search for date field', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    beginningDateTime: t.context.granuleSearchFields.beginningDateTime,
    endingDateTime: t.context.granuleSearchFields.endingDateTime,
    lastUpdateDateTime: t.context.granuleSearchFields.lastUpdateDateTime,
    updatedAt: t.context.granuleSearchFields.updatedAt,
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports term search for number field', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 5,
    duration: t.context.granuleSearchFields.duration,
    productVolume: t.context.granuleSearchFields.productVolume,
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 10);
  t.is(response.results?.length, 5);

  queryStringParameters = {
    limit: 200,
    timeToArchive: t.context.granuleSearchFields.timeToArchive,
    timeToPreprocess: t.context.granuleSearchFields.timeToPreprocess,
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 5);
  t.is(response.results?.length, 5);
});

test('GranuleSearch supports term search for string field', async (t) => {
  const { knex } = t.context;
  let queryStringParameters = {
    limit: 200,
    status: t.context.granuleSearchFields.status,
  };
  let dbSearch = new GranuleSearch({ queryStringParameters });
  let response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);

  queryStringParameters = {
    limit: 200,
    cmrLink: t.context.granuleSearchFields.cmrLink,
  };
  dbSearch = new GranuleSearch({ queryStringParameters });
  response = await dbSearch.query(knex);
  t.is(response.meta.count, 1);
  t.is(response.results?.length, 1);
});

test('GranuleSearch supports term search for timestamp', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    timestamp: t.context.granuleSearchFields.timestamp,
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch supports term search for nested error.Error', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    'error.Error': 'CumulusMessageAdapterExecutionError',
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 50);
  t.is(response.results?.length, 50);
});

test('GranuleSearch non-existing fields are ignored', async (t) => {
  const { knex } = t.context;
  const queryStringParameters = {
    limit: 200,
    non_existing_field: `non_exist_${cryptoRandomString({ length: 5 })}`,
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 100);
});

test('GranuleSearch returns fields specified', async (t) => {
  const { knex } = t.context;
  const fields = 'granuleId,endingDateTime,collectionId,published,status';
  const queryStringParameters = {
    fields,
  };
  const dbSearch = new GranuleSearch({ queryStringParameters });
  const response = await dbSearch.query(knex);
  t.is(response.meta.count, 100);
  t.is(response.results?.length, 10);
  response.results.forEach((granule) => t.deepEqual(Object.keys(granule), fields.split(',')));
});

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
  t.context.granulePgModel = new GranulePgModel();
  t.context.pgGranules = await t.context.granulePgModel.insert(
    knex,
    range(100).map((num) => fakeGranuleRecordFactory({
      granule_id: generateGranuleId(num),
      collection_cumulus_id: (num % 2)
        ? t.context.collectionCumulusId : t.context.collectionCumulusId2,
      pdr_cumulus_id: t.context.pdrCumulusId,
      provider_cumulus_id: t.context.providerCumulusId,
    }))
  );
});

test('Granule search returns 10 granule records by default', async (t) => {
  const { knex } = t.context;
  const dbSearch = new GranuleSearch();
  const response = await dbSearch.query(knex);

  t.is(response.meta.count, 100);

  const apiGranules = response.results || {};
  t.is(apiGranules.length, 10);
  const validatedRecords = apiGranules.filter((granule) => (
    [t.context.collectionId, t.context.collectionId2].includes(granule.collectionId)
    && granule.provider === t.context.provider.name
    && granule.pdrName === t.context.pdr.name));
  t.is(validatedRecords.length, apiGranules.length);
});

test('Granule search supports page and limit params', async (t) => {
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

test('Granule search supports infix search', async (t) => {
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

test('Granule search supports prefix search', async (t) => {
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

test('Granule search supports collectionId term search', async (t) => {
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
//TODO provider and pdr search

'use strict';

const test = require('ava');
const sinon = require('sinon');
const cryptoRandomString = require('crypto-random-string');

const {
  CollectionPgModel,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  fakeProviderRecordFactory,
  generateLocalTestDb,
  getCollectionsByGranuleIds,
  getUniqueCollectionsByGranuleFilter,
  GranulePgModel,
  migrationDir,
  ProviderPgModel,
} = require('../../dist');

test.beforeEach(async (t) => {
  t.context.testDbName = `collection_${cryptoRandomString({ length: 10 })}`;
  const { knexAdmin, knex } = await generateLocalTestDb(
    t.context.testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.collectionPgModel = new CollectionPgModel();
  t.context.providerPgModel = new ProviderPgModel();
  t.context.granulePgModel = new GranulePgModel();

  t.context.oldTimeStamp = '1950-01-01T00:00:00Z';
  t.context.newTimeStamp = '2020-01-01T00:00:00Z';

  t.context.collections = Array.from({ length: 3 }, (_, index) => {
    const name = `collection${index + 1}`;
    return fakeCollectionRecordFactory({ name, version: '001' });
  });
  t.context.pgCollections = await t.context.collectionPgModel.insert(
    t.context.knex,
    t.context.collections,
    '*'
  );
  t.context.providers = Array.from({ length: 2 }, (_, index) => {
    const name = `provider${index + 1}`;
    return fakeProviderRecordFactory({ name });
  });
  t.context.pgProviders = await t.context.providerPgModel.create(
    t.context.knex,
    t.context.providers
  );

  t.context.granules = [
    fakeGranuleRecordFactory({
      collection_cumulus_id: t.context.pgCollections[0].cumulus_id,
      provider_cumulus_id: t.context.pgProviders[0].cumulus_id,
      updated_at: t.context.oldTimeStamp,
    }),
    fakeGranuleRecordFactory({
      collection_cumulus_id: t.context.pgCollections[1].cumulus_id,
      provider_cumulus_id: t.context.pgProviders[1].cumulus_id,
      updated_at: t.context.oldTimeStamp,
    }),
    fakeGranuleRecordFactory({
      collection_cumulus_id: t.context.pgCollections[2].cumulus_id,
      provider_cumulus_id: t.context.pgProviders[1].cumulus_id,
      updated_at: t.context.newTimeStamp,
    }),
  ];

  await t.context.granulePgModel.insert(
    t.context.knex,
    t.context.granules
  );
});

test.afterEach.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
  });
});

test('getCollectionsByGranuleIds() returns collections for given granule IDs', async (t) => {
  const { pgCollections, granules } = t.context;
  const collections = await getCollectionsByGranuleIds(
    t.context.knex,
    granules.map((granule) => granule.granule_id)
  );

  t.deepEqual(collections, pgCollections);
});

test('getCollectionsByGranuleIds() only returns unique collections', async (t) => {
  const { pgCollections } = t.context;
  const testGranule = fakeGranuleRecordFactory({
    collection_cumulus_id: pgCollections[1].cumulus_id,
  });
  await t.context.granulePgModel.insert(
    t.context.knex,
    [testGranule]
  );

  const granules = [...t.context.granules, testGranule];

  const collections = await getCollectionsByGranuleIds(
    t.context.knex,
    granules.map((granule) => granule.granule_id)
  );

  t.deepEqual(collections, pgCollections);
});

test.serial('getCollectionsByGranuleIds() retries on connection terminated unexpectedly error', async (t) => {
  const { knex, pgCollections } = t.context;
  const testGranule = fakeGranuleRecordFactory({
    collection_cumulus_id: pgCollections[1].cumulus_id,
  });
  await t.context.granulePgModel.insert(
    t.context.knex,
    [testGranule]
  );
  const granules = [...t.context.granules, testGranule];

  const knexStub = sinon.stub(knex, 'select').returns({
    select: sinon.stub().returnsThis(),
    innerJoin: sinon.stub().returnsThis(),
    whereIn: sinon.stub().returnsThis(),
    groupBy: sinon.stub().rejects(new Error('Connection terminated unexpectedly')),
  });

  t.teardown(() => knexStub.restore());
  const error = await t.throwsAsync(
    getCollectionsByGranuleIds(
      knexStub,
      granules.map((granule) => granule.granule_id)
    ),
    {
      message: 'Connection terminated unexpectedly',
    }
  );
  t.is(error.attemptNumber, 4);
});

test('getUniqueCollectionsByGranuleFilter filters by startTimestamp', async (t) => {
  const { knex } = t.context;
  const params = {
    startTimestamp: '2005-01-01T00:00:00Z',
    knex,
  };

  const result = await getUniqueCollectionsByGranuleFilter(params);
  t.is(result.length, 1);
});

test('getUniqueCollectionsByGranuleFilter filters by endTimestamp', async (t) => {
  const { knex } = t.context;
  const params = {
    endTimestamp: '2005-01-01T00:00:00Z',
    knex,
  };
  const result = await getUniqueCollectionsByGranuleFilter(params);
  t.is(result.length, 2);
  t.is(result[0].name, 'collection1');
  t.is(result[1].name, 'collection2');
});

test('getUniqueCollectionsByGranuleFilter filters by collectionIds', async (t) => {
  const { knex } = t.context;
  const params = {
    collectionIds: ['collection1___001', 'collection2___001'],
    knex,
  };

  const result = await getUniqueCollectionsByGranuleFilter(params);
  t.is(result.length, 2);
  t.is(result[0].name, 'collection1');
  t.is(result[0].version, '001');
  t.is(result[1].name, 'collection2');
  t.is(result[1].version, '001');
});

test('getUniqueCollectionsByGranuleFilter filters by granuleIds', async (t) => {
  const { knex, granules } = t.context;
  const params = {
    granuleIds: [granules[0].granule_id],
    knex,
  };

  const result = await getUniqueCollectionsByGranuleFilter(params);
  t.is(result.length, 1);
  t.is(result[0].name, 'collection1');
  t.is(result[0].version, '001');
});

test('getUniqueCollectionsByGranuleFilter filters by providers', async (t) => {
  const { knex, providers } = t.context;
  const params = {
    providers: [providers[0].name],
    knex,
  };

  const result = await getUniqueCollectionsByGranuleFilter(params);
  t.is(result.length, 1);
  t.is(result[0].name, 'collection1');
  t.is(result[0].version, '001');
});

test('getUniqueCollectionsByGranuleFilter orders collections by name', async (t) => {
  const { knex } = t.context;
  const params = {
    knex,
  };

  const result = await getUniqueCollectionsByGranuleFilter(params);
  t.is(result.length, 3);
  t.is(result[0].name, 'collection1');
  t.is(result[1].name, 'collection2');
  t.is(result[2].name, 'collection3');
});

test('getUniqueCollectionsByGranuleFilter returns distinct collections', async (t) => {
  const { knex } = t.context;
  const params = {
    knex,
  };

  const granule = fakeGranuleRecordFactory({
    collection_cumulus_id: t.context.pgCollections[0].cumulus_id,
    provider_cumulus_id: t.context.pgProviders[0].cumulus_id,
    updated_at: t.context.oldTimeStamp,
  });
  await t.context.granulePgModel.insert(
    t.context.knex,
    [granule]
  );

  const result = await getUniqueCollectionsByGranuleFilter(params);
  t.is(result.length, 3);
});

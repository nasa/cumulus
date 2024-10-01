'use strict';

const test = require('ava');
const sinon = require('sinon');
const cryptoRandomString = require('crypto-random-string');

const {
  destroyLocalTestDb,
  generateLocalTestDb,
  GranulePgModel,
  CollectionPgModel,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  getCollectionsByGranuleIds,
  migrationDir,
} = require('../../dist');

const testDbName = `collection_${cryptoRandomString({ length: 10 })}`;

test.beforeEach(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.collectionPgModel = new CollectionPgModel();
  t.context.granulePgModel = new GranulePgModel();

  t.context.collection1 = fakeCollectionRecordFactory();
  t.context.collection2 = fakeCollectionRecordFactory();
  t.context.pgCollections = await t.context.collectionPgModel.insert(
    t.context.knex,
    [t.context.collection1, t.context.collection2],
    '*'
  );

  t.context.granules = [
    fakeGranuleRecordFactory({ collection_cumulus_id: t.context.pgCollections[0].cumulus_id }),
    fakeGranuleRecordFactory({ collection_cumulus_id: t.context.pgCollections[1].cumulus_id }),
  ];

  await t.context.granulePgModel.insert(
    t.context.knex,
    t.context.granules
  );
});

test.afterEach.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test.serial('getCollectionsByGranuleIds() returns collections for given granule IDs', async (t) => {
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

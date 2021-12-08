'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const { constructCollectionId } = require('@cumulus/message/Collections');

const {
  destroyLocalTestDb,
  generateLocalTestDb,
  GranulePgModel,
  CollectionPgModel,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  getCollectionsByGranuleIds,
  migrationDir,
  getCumulusCollectionIdsByCollectionIds,
} = require('../../dist');

const testDbName = `collection_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.collectionPgModel = new CollectionPgModel();
  t.context.granulePgModel = new GranulePgModel();
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('getCollectionsByGranuleIds() returns collections for given granule IDs', async (t) => {
  const collection1 = fakeCollectionRecordFactory();
  const collection2 = fakeCollectionRecordFactory();

  const pgCollections = await t.context.collectionPgModel.insert(
    t.context.knex,
    [collection1, collection2],
    '*'
  );

  const granules = [
    fakeGranuleRecordFactory({ collection_cumulus_id: pgCollections[0].cumulus_id }),
    fakeGranuleRecordFactory({ collection_cumulus_id: pgCollections[1].cumulus_id }),
  ];
  await t.context.granulePgModel.insert(
    t.context.knex,
    granules
  );

  const collections = await getCollectionsByGranuleIds(
    t.context.knex,
    granules.map((granule) => granule.granule_id)
  );

  t.deepEqual(collections, pgCollections);
});

test('getCollectionsByGranuleIds() only returns unique collections', async (t) => {
  const collection1 = fakeCollectionRecordFactory();
  const collection2 = fakeCollectionRecordFactory();

  const pgCollections = await t.context.collectionPgModel.insert(
    t.context.knex,
    [collection1, collection2],
    '*'
  );

  const granules = [
    fakeGranuleRecordFactory({ collection_cumulus_id: pgCollections[0].cumulus_id }),
    fakeGranuleRecordFactory({ collection_cumulus_id: pgCollections[1].cumulus_id }),
    fakeGranuleRecordFactory({ collection_cumulus_id: pgCollections[1].cumulus_id }),
  ];
  await t.context.granulePgModel.insert(
    t.context.knex,
    granules
  );

  const collections = await getCollectionsByGranuleIds(
    t.context.knex,
    granules.map((granule) => granule.granule_id)
  );

  t.deepEqual(collections, pgCollections);
});

test('getCumulusCollectionIdsByCollectionIds returns cumulus_collection_ids for a collectionId', async (t) => {
  const collection0 = fakeCollectionRecordFactory();
  const collection1 = fakeCollectionRecordFactory();
  const collection2 = fakeCollectionRecordFactory();
  const collection3 = fakeCollectionRecordFactory();

  await t.context.collectionPgModel.insert(
    t.context.knex,
    [collection0, collection1, collection2, collection3],
    '*'
  );
  const testCollections = [
    collection0,
    collection2,
  ].map((collection) => constructCollectionId(collection.name, collection.version));

  const expectedIds = [
    await t.context.collectionPgModel.getRecordCumulusId(t.context.knex, collection0),
    await t.context.collectionPgModel.getRecordCumulusId(t.context.knex, collection2),
  ];

  const actualIds = await getCumulusCollectionIdsByCollectionIds(t.context.knex, testCollections);

  t.deepEqual(actualIds, expectedIds);
});

test('getCumulusCollectionIdsByCollectionIds ignores collectionId that are not found', async (t) => {
  const collection0 = fakeCollectionRecordFactory();
  const collection1 = fakeCollectionRecordFactory();
  const collection2 = fakeCollectionRecordFactory();
  const collection3 = fakeCollectionRecordFactory();

  await t.context.collectionPgModel.insert(
    t.context.knex,
    [collection0, collection1, collection2, collection3],
    '*'
  );
  const testCollections = [
    collection0,
    { name: 'not', version: 'found' },
    collection2,
  ].map((collection) => constructCollectionId(collection.name, collection.version));

  const expectedIds = [
    await t.context.collectionPgModel.getRecordCumulusId(t.context.knex, collection0),
    await t.context.collectionPgModel.getRecordCumulusId(t.context.knex, collection2),
  ];

  const actualIds = await getCumulusCollectionIdsByCollectionIds(t.context.knex, testCollections);

  t.deepEqual(actualIds, expectedIds);
});

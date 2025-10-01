const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { constructCollectionId } = require('@cumulus/message/Collections');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  generateLocalTestDb,
  GranulePgModel,
  GranuleGroupsPgModel,
  migrationDir,
} = require('../../dist');

const { getNextGranuleGroupId, findDuplicateGranules } = require('../../dist/lib/duplicate-detection');

// Insert multiple granules with the same producerGranuleId into the specified collection.
const insertGranulesWithProducerId = async ({
  knex,
  granulePgModel,
  count,
  collectionCumulusId,
  producerGranuleId,
  granuleIdPrefix = 'g',
}) => await granulePgModel.insert(
  knex,
  Array.from({ length: count }, (_, i) =>
    fakeGranuleRecordFactory({
      granule_id: `${granuleIdPrefix}-${i}`,
      producer_granule_id: producerGranuleId,
      collection_cumulus_id: collectionCumulusId,
    }))
);

// Mark the provided granules as active or inactive in the granule_groups table.
const setGranuleGroupStates = async (knex, granules, state) => {
  const granuleGroupsPgModel = new GranuleGroupsPgModel();
  await Promise.all(
    granules.map((g) =>
      granuleGroupsPgModel.create(knex, {
        granule_cumulus_id: g.cumulus_id,
        state,
      }))
  );
};

test.before(async (t) => {
  t.context.testDbName = `granule_${cryptoRandomString({ length: 10 })}`;
  const { knexAdmin, knex } = await generateLocalTestDb(t.context.testDbName, migrationDir);
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;
  t.context.granulePgModel = new GranulePgModel();
  t.context.collectionPgModel = new CollectionPgModel();

  const collections = [
    { name: 'fakeCollection', version: 'v1' },
    { name: 'testCollection2', version: 'v2' },
  ];

  for (const [i, { name, version }] of collections.entries()) {
    const collectionId = constructCollectionId(name, version);
    const testPgCollection = fakeCollectionRecordFactory({ name, version });

    /* eslint-disable-next-line no-await-in-loop */
    const [pgCollection] = await t.context.collectionPgModel.create(knex, testPgCollection);

    // Save to context, when i is 0, nothing is appended
    t.context[`collectionId${i || ''}`] = collectionId;
    t.context[`testPgCollection${i || ''}`] = testPgCollection;
    t.context[`collectionCumulusId${i || ''}`] = pgCollection.cumulus_id;
  }
});

test.after.always(async (t) => {
  await destroyLocalTestDb(t.context);
});

test('getNextGranuleGroupId returns increasing sequence values', async (t) => {
  const knex = t.context.knex;

  const id1 = await getNextGranuleGroupId(knex);
  const id2 = await getNextGranuleGroupId(knex);

  t.true(Number.isInteger(id1));
  t.true(Number.isInteger(id2));
  t.true(id2 > id1, 'Second call should return a higher group_id');
});

test('findDuplicateGranules finds multiple duplicates in same collection', async (t) => {
  const { knex, collectionId, collectionCumulusId, granulePgModel } = t.context;

  const producerGranuleId = 'same-producer-id-same-collection';

  await insertGranulesWithProducerId({
    knex,
    granulePgModel,
    count: 3,
    collectionCumulusId,
    producerGranuleId,
    granuleIdPrefix: 'same-coll',
  });

  const result = await findDuplicateGranules({
    collectionId,
    producerGranuleId,
    collectionCumulusId,
  }, knex);

  t.is(result.sameCollectionMatches.length, 3);
  t.is(result.differentCollectionMatches.length, 0);
});

test('findDuplicateGranules finds duplicates across collections', async (t) => {
  const {
    knex,
    collectionId1,
    collectionCumulusId,
    collectionCumulusId1,
    granulePgModel,
  } = t.context;

  const producerGranuleId = 'shared-producer-id-multi-collection';

  await insertGranulesWithProducerId({
    knex,
    granulePgModel,
    count: 2,
    collectionCumulusId,
    producerGranuleId,
    granuleIdPrefix: 'diff-1',
  });

  await insertGranulesWithProducerId({
    knex,
    granulePgModel,
    count: 3,
    collectionCumulusId: collectionCumulusId1,
    producerGranuleId,
    granuleIdPrefix: 'diff-2',
  });

  const result = await findDuplicateGranules({
    collectionId: collectionId1,
    producerGranuleId,
    collectionCumulusId: collectionCumulusId1,
  }, knex);

  t.is(result.sameCollectionMatches.length, 3);
  t.is(result.differentCollectionMatches.length, 2);
});

test('findDuplicateGranules excludes granule with matching granuleId', async (t) => {
  const { knex, collectionId, collectionCumulusId, granulePgModel } = t.context;

  const producerGranuleId = 'producer-id-self-test';
  const selfGranuleId = 'self-exclude-granule';

  await granulePgModel.insert(knex, [
    fakeGranuleRecordFactory({
      granule_id: selfGranuleId,
      producer_granule_id: producerGranuleId,
      collection_cumulus_id: collectionCumulusId,
    }),
  ]);

  await insertGranulesWithProducerId({
    knex,
    granulePgModel,
    count: 2,
    collectionCumulusId,
    producerGranuleId,
    granuleIdPrefix: 'other',
  });

  const result = await findDuplicateGranules({
    collectionId,
    producerGranuleId,
    collectionCumulusId,
    granuleId: selfGranuleId,
  }, knex);

  t.is(result.sameCollectionMatches.length, 2);
  t.false(result.sameCollectionMatches.some((g) => g.granule_id === selfGranuleId));
});

test('findDuplicateGranules excludes inactive granules from results', async (t) => {
  const { knex, collectionId, collectionCumulusId, granulePgModel } = t.context;
  const producerGranuleId = 'producer-id-active-test';

  const inactiveGranules = await insertGranulesWithProducerId({
    knex,
    granulePgModel,
    count: 2,
    collectionCumulusId,
    producerGranuleId,
    granuleIdPrefix: 'inactive',
  });

  const activeGranules = await insertGranulesWithProducerId({
    knex,
    granulePgModel,
    count: 2,
    collectionCumulusId,
    producerGranuleId,
    granuleIdPrefix: 'active',
  });

  await setGranuleGroupStates(knex, inactiveGranules, 'H');
  await setGranuleGroupStates(knex, activeGranules, 'A');

  const result = await findDuplicateGranules({
    collectionId,
    producerGranuleId,
    collectionCumulusId,
  }, knex);

  t.is(result.sameCollectionMatches.length, 2);
  t.true(result.sameCollectionMatches.every((g) => g.granule_id.startsWith('active')));
});

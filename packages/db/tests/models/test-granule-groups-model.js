const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  CollectionPgModel,
  GranulePgModel,
  GranuleGroupsPgModel,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  fakeGranuleGroupRecordFactory,
  generateLocalTestDb,
  destroyLocalTestDb,
  migrationDir,
} = require('../../dist');

const testDbName = `granule_group_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.granuleGroupsModel = new GranuleGroupsPgModel();
  t.context.granulesModel = new GranulePgModel();
  t.context.collectionsModel = new CollectionPgModel();

  const [pgCollection] = await t.context.collectionsModel.create(
    t.context.knex,
    fakeCollectionRecordFactory()
  );
  t.context.collectionCumulusId = pgCollection.cumulus_id;

  const fakeGranule1 = fakeGranuleRecordFactory({
    collection_cumulus_id: t.context.collectionCumulusId,
  });
  const pgGranule1 = await t.context.granulesModel.create(
    t.context.knex,
    fakeGranule1
  );

  const fakeGranule2 = fakeGranuleRecordFactory({
    collection_cumulus_id: t.context.collectionCumulusId,
  });
  const pgGranule2 = await t.context.granulesModel.create(
    t.context.knex,
    fakeGranule2
  );

  t.context.pgGranule1 = pgGranule1[0];
  t.context.pgGranule2 = pgGranule2[0];
  t.context.granuleCumulusId1 = pgGranule1[0].cumulus_id;
  t.context.granuleCumulusId2 = pgGranule2[0].cumulus_id;
  t.context.groupId = 1;
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test.serial('GranuleGroupsPgModel.upsert() successfully creates a new granuleGroup record ', async (t) => {
  const {
    knex,
    granuleGroupsModel,
    granuleCumulusId1,
    groupId,
  } = t.context;

  const granuleGroup = fakeGranuleGroupRecordFactory({
    granule_cumulus_id: granuleCumulusId1,
    status: 'A',
    group_id: groupId,
  });

  await granuleGroupsModel.upsert(knex, granuleGroup);

  t.like(
    await granuleGroupsModel.get(knex, granuleGroup),
    granuleGroup
  );
});

test.serial('GranuleGroupsPgModel.upsert() successfully overwrites a granuleGroup record ', async (t) => {
  const {
    knex,
    granuleGroupsModel,
    granuleCumulusId2,
    groupId,
  } = t.context;

  const granuleGroup = fakeGranuleGroupRecordFactory({
    granule_cumulus_id: granuleCumulusId2,
    status: 'A',
    group_id: groupId,
  });

  await granuleGroupsModel.create(knex, granuleGroup);

  t.like(
    await granuleGroupsModel.get(knex, granuleGroup),
    granuleGroup
  );

  const updatedGranuleGroup = {
    ...granuleGroup,
    status: 'H',
  };

  await granuleGroupsModel.upsert(knex, updatedGranuleGroup);
  t.like(
    await granuleGroupsModel.get(knex, {
      granule_cumulus_id: granuleGroup.granule_cumulus_id,
      group_id: granuleGroup.group_id,
    }),
    updatedGranuleGroup
  );
});

test.serial('GranuleGroupsPgModel.searchByGranuleCumulusIds() returns relevant group records and allows specifying desired columns', async (t) => {
  const {
    knex,
    pgGranule1,
    pgGranule2,
    granuleGroupsModel,
    granuleCumulusId1,
    granuleCumulusId2,
    groupId,
  } = t.context;

  let searched = await granuleGroupsModel.searchByGranuleCumulusIds(
    knex,
    [granuleCumulusId1, granuleCumulusId2]
  );

  const expectedGroupRecord1 = {
    cumulus_id: 1,
    granule_cumulus_id: pgGranule1.cumulus_id,
    status: 'A',
    group_id: groupId,
  };
  const expectedGroupRecord2 = {
    cumulus_id: 2,
    granule_cumulus_id: pgGranule2.cumulus_id,
    status: 'H',
    group_id: groupId,
  };

  t.like(searched[0], expectedGroupRecord1);
  t.like(searched[1], expectedGroupRecord2);

  searched = await granuleGroupsModel.searchByGranuleCumulusIds(
    knex,
    [granuleCumulusId1, granuleCumulusId2],
    'cumulus_id'
  );
  searched.forEach((item) => {
    t.true(item.granule_cumulus_id === undefined);
    t.true(item.created_at === undefined);
    t.true(item.updated_at === undefined);
    t.true(item.group_id === undefined);
    t.true(item.status === undefined);
  });

  t.true(searched[0].cumulus_id === pgGranule1.cumulus_id
    && searched[1].cumulus_id === pgGranule2.cumulus_id);
});

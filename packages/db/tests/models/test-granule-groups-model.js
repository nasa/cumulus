const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');

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

  const fakeGranules = await t.context.granulesModel.insert(
    t.context.knex,
    range(4).map(() => fakeGranuleRecordFactory({
      collection_cumulus_id: t.context.collectionCumulusId,
    }))
  );

  t.context.granuleCumulusId1 = fakeGranules[0].cumulus_id;
  t.context.granuleCumulusId2 = fakeGranules[1].cumulus_id;
  t.context.granuleCumulusId3 = fakeGranules[2].cumulus_id;
  t.context.granuleCumulusId4 = fakeGranules[3].cumulus_id;
  t.context.groupId = 1;
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test.serial('GranuleGroupsPgModel.upsert() successfully creates a new granuleGroup record and search() returns that record', async (t) => {
  const {
    knex,
    granuleGroupsModel,
    granuleCumulusId1,
    groupId,
  } = t.context;

  const granuleGroup = fakeGranuleGroupRecordFactory({
    granule_cumulus_id: granuleCumulusId1,
    state: 'A',
    group_id: groupId,
  });

  await granuleGroupsModel.create(knex, granuleGroup);
  const searchedGranule = (await granuleGroupsModel.search(knex, granuleGroup))[0];
  t.like(searchedGranule, granuleGroup);
  t.true(await granuleGroupsModel.exists(knex, granuleGroup));
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
    state: 'A',
    group_id: groupId,
  });

  const createdGranule = (await granuleGroupsModel.create(knex, granuleGroup))[0];

  t.like(
    createdGranule,
    granuleGroup
  );

  const updatedGranuleGroup = {
    ...granuleGroup,
    state: 'H',
  };

  await granuleGroupsModel.upsert(knex, updatedGranuleGroup);
  t.like(
    (await granuleGroupsModel.search(knex, {
      granule_cumulus_id: granuleGroup.granule_cumulus_id,
      group_id: granuleGroup.group_id,
    }))[0],
    updatedGranuleGroup
  );
});

test.serial('GranuleGroupsPgModel.deletes() successfully deletes a granuleGroup record and exists() correctly identifies if it exists or not', async (t) => {
  const {
    knex,
    granuleGroupsModel,
    granuleCumulusId3,
    groupId,
  } = t.context;

  const granuleGroup = fakeGranuleGroupRecordFactory({
    granule_cumulus_id: granuleCumulusId3,
    state: 'A',
    group_id: groupId,
  });

  await granuleGroupsModel.create(knex, granuleGroup);
  t.true(await granuleGroupsModel.exists(knex, granuleGroup));
  await granuleGroupsModel.delete(knex, granuleGroup);
  t.false(await granuleGroupsModel.exists(knex, granuleGroup));
});

test.serial('GranuleGroupsPgModel.searchByGranuleCumulusIds() returns relevant group records and allows specifying desired columns', async (t) => {
  const {
    knex,
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
    granule_cumulus_id: granuleCumulusId1,
    state: 'A',
    group_id: groupId,
  };
  const expectedGroupRecord2 = {
    granule_cumulus_id: granuleCumulusId2,
    state: 'H',
    group_id: groupId,
  };

  t.like(searched[0], expectedGroupRecord1);
  t.like(searched[1], expectedGroupRecord2);

  searched = await granuleGroupsModel.searchByGranuleCumulusIds(
    knex,
    [granuleCumulusId1, granuleCumulusId2],
    'granule_cumulus_id'
  );
  searched.forEach((item) => {
    t.true(item.created_at === undefined);
    t.true(item.updated_at === undefined);
    t.true(item.group_id === undefined);
    t.true(item.state === undefined);
  });

  t.true(searched[0].granule_cumulus_id === granuleCumulusId1
    && searched[1].granule_cumulus_id === granuleCumulusId2);
});

test.serial('GranuleGroupsPgModel.insert() successfully inserts multiple granuleGroup record and count() properly counts them', async (t) => {
  const {
    knex,
    granuleGroupsModel,
    granuleCumulusId3,
    granuleCumulusId4,
    groupId,
  } = t.context;

  const granuleGroup3 = fakeGranuleGroupRecordFactory({
    granule_cumulus_id: granuleCumulusId3,
    state: 'A',
    group_id: groupId,
  });
  const granuleGroup4 = fakeGranuleGroupRecordFactory({
    granule_cumulus_id: granuleCumulusId4,
    state: 'H',
    group_id: groupId,
  });

  await granuleGroupsModel.insert(knex, [granuleGroup3, granuleGroup4]);
  t.true(await granuleGroupsModel.exists(knex, granuleGroup3) &&
    await granuleGroupsModel.exists(knex, granuleGroup4));

  const count = await granuleGroupsModel.count(knex, [{
    group_id: groupId,
  }]);

  t.true(count[0].count === '4');
});

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { migrationDir } = require('../../../../lambdas/db-migration/dist/lambda');

const {
  generateLocalTestDb,
  destroyLocalTestDb,
  FilePgModel,
  GranulePgModel,
  CollectionPgModel,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  getFilesAndGranuleInfoQuery,
} = require('../../dist');

test.before(async (t) => {
  t.context.testDbName = `file_${cryptoRandomString({ length: 10 })}`;

  const { knexAdmin, knex } = await generateLocalTestDb(
    t.context.testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.collectionPgModel = new CollectionPgModel();
  t.context.filePgModel = new FilePgModel();
  t.context.granulePgModel = new GranulePgModel();

  const testCollection = fakeCollectionRecordFactory();
  [t.context.collectionCumulusId] = await t.context.collectionPgModel.create(
    t.context.knex,
    testCollection
  );
});

test.after.always(async (t) => {
  await destroyLocalTestDb(t.context);
});

test('getFilesAndGranuleInfoQuery returns expected records', async (t) => {
  const { collectionCumulusId, filePgModel, knex } = t.context;

  const testGranule1 = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });
  const [granuleCumulusId1] = await t.context.granulePgModel.create(
    t.context.knex,
    testGranule1
  );

  const testGranule2 = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });
  const [granuleCumulusId2] = await t.context.granulePgModel.create(
    t.context.knex,
    testGranule2
  );

  const bucket = cryptoRandomString({ length: 10 });
  const firstKey = `a_${cryptoRandomString({ length: 10 })}`;
  await filePgModel.create(knex, {
    bucket,
    key: firstKey,
    granule_cumulus_id: granuleCumulusId1,
  });
  const secondKey = `b_${cryptoRandomString({ length: 10 })}`;
  await filePgModel.create(knex, {
    bucket,
    key: secondKey,
    granule_cumulus_id: granuleCumulusId2,
  });

  const records = await getFilesAndGranuleInfoQuery({
    knex,
    searchParams: { bucket },
    sortColumns: ['bucket', 'key'],
    granuleColumns: ['granule_id'],
  });
  t.is(records.length, 2);
  t.like(records[0], {
    bucket,
    key: firstKey,
    granule_cumulus_id: Number.parseInt(granuleCumulusId1, 10),
    granule_id: testGranule1.granule_id,
  });
  t.like(records[1], {
    bucket,
    key: secondKey,
    granule_cumulus_id: Number.parseInt(granuleCumulusId2, 10),
    granule_id: testGranule2.granule_id,
  });
});

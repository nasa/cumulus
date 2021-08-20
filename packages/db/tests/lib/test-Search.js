const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { migrationDir } = require('../../../../lambdas/db-migration/dist/lambda');

const {
  generateLocalTestDb,
  destroyLocalTestDb,
  FilePgModel,
  Search,
  GranulePgModel,
  CollectionPgModel,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
} = require('../../dist');

test.before(async (t) => {
  t.context.testDbName = `search_${cryptoRandomString({ length: 10 })}`;

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
  const [collectionCumulusId] = await t.context.collectionPgModel.create(
    t.context.knex,
    testCollection
  );

  const testGranule = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });
  [t.context.granuleCumulusId] = await t.context.granulePgModel.create(
    t.context.knex,
    testGranule
  );
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
  });
});

test('Search.next() returns the next result', async (t) => {
  const { filePgModel, granuleCumulusId, knex } = t.context;

  const bucket = cryptoRandomString({ length: 10 });
  const firstKey = `a_${cryptoRandomString({ length: 10 })}`;
  await filePgModel.create(knex, {
    bucket,
    key: firstKey,
    granule_cumulus_id: granuleCumulusId,
  });
  const secondKey = `b_${cryptoRandomString({ length: 10 })}`;
  await filePgModel.create(knex, {
    bucket,
    key: secondKey,
    granule_cumulus_id: granuleCumulusId,
  });

  const fileSearchClient = new Search({
    knex,
    pgModel: filePgModel,
    searchParams: { bucket },
    sortColumns: ['bucket', 'key'],
  });
  t.like(
    await fileSearchClient.next(),
    {
      bucket,
      key: firstKey,
    }
  );
  t.like(
    await fileSearchClient.next(),
    {
      bucket,
      key: secondKey,
    }
  );
});

test('Search.next() returns undefined if no record exists for current offset', async (t) => {
  const { filePgModel, knex } = t.context;

  const bucket = cryptoRandomString({ length: 10 });

  const fileSearchClient = new Search({
    knex,
    pgModel: filePgModel,
    searchParams: { bucket },
    sortColumns: ['bucket', 'key'],
  });
  t.is(
    await fileSearchClient.next(),
    undefined
  );
});

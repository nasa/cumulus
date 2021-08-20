const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { migrationDir } = require('../../../../lambdas/db-migration/dist/lambda');

const {
  generateLocalTestDb,
  destroyLocalTestDb,
  FilePgModel,
  QuerySearchClient,
  GranulePgModel,
  CollectionPgModel,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  getFilesAndGranuleIdQuery,
} = require('../../dist');

test.before(async (t) => {
  t.context.testDbName = `query_client_${cryptoRandomString({ length: 10 })}`;

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

test('QuerySearchClient.getNextRecord() returns next record correctly', async (t) => {
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

  const query = getFilesAndGranuleIdQuery({
    knex,
    searchParams: { bucket },
    sortColumns: ['bucket', 'key'],
  });
  const querySearchClient = new QuerySearchClient(
    query
  );
  t.like(
    await querySearchClient.getNextRecord(),
    {
      bucket,
      key: firstKey,
    }
  );
  t.like(
    await querySearchClient.getNextRecord(),
    {
      bucket,
      key: secondKey,
    }
  );
});

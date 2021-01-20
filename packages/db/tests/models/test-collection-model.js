const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  CollectionPgModel,
  fakeCollectionRecordFactory,
  generateLocalTestDb,
  destroyLocalTestDb,
} = require('../../dist');

const { migrationDir } = require('../../../../lambdas/db-migration');

const testDbName = `collection_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.collectionPgModel = new CollectionPgModel();
});

test.beforeEach((t) => {
  t.context.collectionRecord = fakeCollectionRecordFactory();
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('CollectionPgModel.upsert() creates new collection', async (t) => {
  const {
    knex,
    collectionPgModel,
    collectionRecord,
  } = t.context;

  await collectionPgModel.upsert(knex, collectionRecord);

  t.like(
    await collectionPgModel.get(knex, collectionRecord),
    {
      ...collectionRecord,
      files: JSON.parse(collectionRecord.files),
    }
  );
});

test('CollectionPgModel.upsert() updates collection', async (t) => {
  const {
    knex,
    collectionPgModel,
    collectionRecord,
  } = t.context;

  await collectionPgModel.create(knex, collectionRecord);

  const sampleFileName = cryptoRandomString({ length: 5 });
  collectionRecord.sample_file_name = sampleFileName;

  await collectionPgModel.upsert(knex, collectionRecord);

  t.like(
    await collectionPgModel.get(knex, collectionRecord),
    {
      ...collectionRecord,
      files: JSON.parse(collectionRecord.files),
      sample_file_name: sampleFileName,
    }
  );
});

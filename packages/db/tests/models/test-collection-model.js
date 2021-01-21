const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  CollectionPgModel,
  generateLocalTestDb,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
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

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('CollectionPgModel.upsert() creates a new record', async (t) => {
  const {
    knex,
    collectionPgModel,
  } = t.context;

  const collection = fakeCollectionRecordFactory();

  await collectionPgModel.upsert(knex, collection);

  t.like(
    await collectionPgModel.get(knex, collection),
    {
      ...collection,
      files: JSON.parse(collection.files),
    }
  );
});

test('CollectionPgModel.upsert() overwrites a file record', async (t) => {
  const {
    knex,
    collectionPgModel,
  } = t.context;

  const collection = fakeCollectionRecordFactory();

  await collectionPgModel.create(knex, collection);

  const updatedCollection = {
    ...collection,
    sample_file_name: cryptoRandomString({ length: 3 }),
  };

  await collectionPgModel.upsert(knex, updatedCollection);

  t.like(
    await collectionPgModel.get(knex, {
      name: collection.name,
      version: collection.version,
    }),
    {
      ...updatedCollection,
      files: JSON.parse(updatedCollection.files),
    }
  );
});

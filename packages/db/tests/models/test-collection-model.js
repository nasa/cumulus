const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  CollectionPgModel,
  fakeCollectionRecordFactory,
  generateLocalTestDb,
  destroyLocalTestDb,
  migrationDir,
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

test.serial('CollectionPgModel.upsert() creates new collection', async (t) => {
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
      meta: collectionRecord.meta,
    }
  );
});

test.serial('CollectionPgModel.upsert() overwrites a collection record', async (t) => {
  const {
    knex,
    collectionPgModel,
    collectionRecord,
  } = t.context;

  await collectionPgModel.create(knex, collectionRecord);

  const updatedCollection = {
    ...collectionRecord,
    sample_file_name: cryptoRandomString({ length: 3 }),
  };

  await collectionPgModel.upsert(knex, updatedCollection);

  t.like(
    await collectionPgModel.get(knex, {
      name: collectionRecord.name,
      version: collectionRecord.version,
    }),
    {
      ...updatedCollection,
      files: JSON.parse(updatedCollection.files),
      meta: collectionRecord.meta,
    }
  );
});

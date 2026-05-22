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
      meta: collectionRecord.meta,
    }
  );
});

test('CollectionPgModel.upsert() overwrites a collection record', async (t) => {
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

test('CollectionPgModel.getMission() gets a collection mission', async (t) => {
  const {
    knex,
    collectionPgModel,
    collectionRecord,
  } = t.context;
  const [dbCollection] = await collectionPgModel.create(knex, collectionRecord);
  const mission = await collectionPgModel.getMission(knex, dbCollection.cumulus_id);
  t.is(mission, collectionRecord.mission);
  const collectionRecord2 = fakeCollectionRecordFactory({ mission: 'anyotherstring' });

  const [dbCollections] = await collectionPgModel.create(knex, collectionRecord2);
  const mission2 = await collectionPgModel.getMission(knex, dbCollections.cumulus_id);
  t.is(mission2, collectionRecord2.mission);
});

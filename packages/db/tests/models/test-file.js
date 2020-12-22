const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  localStackConnectionEnv,
  getKnexClient,
  CollectionPgModel,
  GranulePgModel,
  FilePgModel,
} = require('../../dist');
const {
  fakeCollectionRecordFactory,
  fakeFileRecordFactory,
  fakeGranuleRecordFactory,
} = require('../../dist/test-utils');

const { migrationDir } = require('../../../../lambdas/db-migration');

const testDbName = `file_${cryptoRandomString({ length: 10 })}`;
const testDbUser = 'postgres';

test.before(async (t) => {
  t.context.knexAdmin = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      migrationDir,
    },
  });
  await t.context.knexAdmin.raw(`create database "${testDbName}";`);
  await t.context.knexAdmin.raw(`grant all privileges on database "${testDbName}" to "${testDbUser}"`);

  t.context.knex = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      PG_DATABASE: testDbName,
      migrationDir,
    },
  });

  // create tables
  await t.context.knex.migrate.latest();

  const collectionPgModel = new CollectionPgModel();
  const [collectionCumulusId] = await collectionPgModel.create(
    t.context.knex,
    fakeCollectionRecordFactory()
  );

  const granulePgModel = new GranulePgModel();
  const [granuleCumulusId] = await granulePgModel.create(
    t.context.knex,
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
    })
  );
  // bigint for granule cumulus_id is treated as a string,
  // not number, by knex
  // see https://github.com/knex/knex/issues/387
  t.context.granuleCumulusId = Number.parseInt(granuleCumulusId, 10);

  t.context.filePgModel = new FilePgModel();
});

test.after.always(async (t) => {
  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${testDbName}"`);
  await t.context.knexAdmin.destroy();
});

test('FilePgModel.upsert() creates a new file record', async (t) => {
  const {
    knex,
    filePgModel,
    granuleCumulusId,
  } = t.context;

  const file = fakeFileRecordFactory({
    granule_cumulus_id: granuleCumulusId,
  });

  await filePgModel.upsert(knex, file);

  t.like(
    await filePgModel.get(knex, file),
    file
  );
});

test('FilePgModel.upsert() overwrites a file record', async (t) => {
  const {
    knex,
    filePgModel,
    granuleCumulusId,
  } = t.context;

  const file = fakeFileRecordFactory({
    granule_cumulus_id: granuleCumulusId,
    checksum_value: cryptoRandomString({ length: 3 }),
  });
  await filePgModel.create(knex, file);

  const updatedFile = {
    ...file,
    checksum_value: cryptoRandomString({ length: 3 }),
  };
  await filePgModel.upsert(knex, updatedFile);

  t.like(
    await filePgModel.get(knex, {
      bucket: file.bucket,
      key: file.key,
    }),
    updatedFile
  );
});

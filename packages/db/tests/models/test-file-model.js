const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const {
  randomId,
} = require('@cumulus/common/test-utils');

const {
  CollectionPgModel,
  GranulePgModel,
  FilePgModel,
  generateLocalTestDb,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeFileRecordFactory,
  fakeGranuleRecordFactory,
} = require('../../dist');

const { migrationDir } = require('../../../../lambdas/db-migration');

const testDbName = `file_${cryptoRandomString({ length: 10 })}`;

let granulePgModel;

const createFakeGranule = async (dbClient) => {
  // Collection is a required fk for granules
  const collectionPgModel = new CollectionPgModel();
  const [collectionCumulusId] = await collectionPgModel.create(
    dbClient,
    fakeCollectionRecordFactory()
  );

  granulePgModel = new GranulePgModel();
  const [granuleCumulusId] = await granulePgModel.create(
    dbClient,
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      status: 'running',
    })
  );
  // bigint for granule cumulus_id is treated as a string,
  // not number, by knex
  // see https://github.com/knex/knex/issues/387
  return Number.parseInt(granuleCumulusId, 10);
};

const saveFilesToPG = async (dbClient, filePgModel, granuleCumulusId) => {
  const buckets = {
    protected: {
      name: randomId('protected'),
      type: 'protected',
    },
    public: {
      name: randomId('public'),
      type: 'public',
    },
  };

  const files = [
    fakeFileRecordFactory({
      bucket: buckets.protected.name,
      file_name: `${granuleCumulusId}.hdf`,
      granule_cumulus_id: granuleCumulusId,
    }),
    fakeFileRecordFactory({
      bucket: buckets.protected.name,
      file_name: `${granuleCumulusId}.cmr.xml`,
      granule_cumulus_id: granuleCumulusId,
    }),
    fakeFileRecordFactory({
      bucket: buckets.public.name,
      file_name: `${granuleCumulusId}.jpg`,
      granule_cumulus_id: granuleCumulusId,
    }),
  ];

  // Add files to PG
  await Promise.all(files.map((f) => filePgModel.create(dbClient, f)));
};

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.granuleCumulusId = await createFakeGranule(t.context.knex);
  t.context.filePgModel = new FilePgModel();
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
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

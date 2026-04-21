const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');
const {
  CollectionPgModel,
  GranulePgModel,
  FilePgModel,
  generateLocalTestDb,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeFileRecordFactory,
  fakeGranuleRecordFactory,
  migrationDir,
} = require('../../dist');

const testDbName = `file_${cryptoRandomString({ length: 10 })}`;

let granulePgModel;

const createFakeGranule = async (dbClient) => {
  // Collection is a required fk for granules
  const collectionPgModel = new CollectionPgModel();

  const [pgCollection] = await collectionPgModel.create(
    dbClient,
    fakeCollectionRecordFactory()
  );
  const collectionCumulusId = pgCollection.cumulus_id;

  granulePgModel = new GranulePgModel();
  const [pgGranule] = await granulePgModel.create(
    dbClient,
    fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      status: 'running',
    })
  );

  // bigint for granule cumulus_id is treated as a string,
  // not number, by knex
  // see https://github.com/knex/knex/issues/387
  return pgGranule;
};

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  const pgGranule = await createFakeGranule(t.context.knex);
  t.context.granuleCumulusId = pgGranule.cumulus_id;
  t.context.collectionCumulusId = pgGranule.collection_cumulus_id;
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
    collectionCumulusId,
    filePgModel,
    granuleCumulusId,
  } = t.context;

  const file = fakeFileRecordFactory({
    granule_cumulus_id: granuleCumulusId,
    collection_cumulus_id: collectionCumulusId,
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
    collectionCumulusId,
    filePgModel,
    granuleCumulusId,
  } = t.context;

  const file = fakeFileRecordFactory({
    granule_cumulus_id: granuleCumulusId,
    collection_cumulus_id: collectionCumulusId,
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

test('FilePgModel.upsert() creates multiple file records', async (t) => {
  const {
    knex,
    collectionCumulusId,
    filePgModel,
    granuleCumulusId,
  } = t.context;

  const files = Array.from({ length: 1000 }, () =>
    fakeFileRecordFactory({
      granule_cumulus_id: granuleCumulusId,
      collection_cumulus_id: collectionCumulusId,
    }));

  const result = await filePgModel.upsert(knex, files);
  t.is(result.length, 1000);
  await Promise.all(files.map(async (file) => {
    t.like(
      await filePgModel.get(knex, file),
      file
    );
  }));
});

test('FilePgModel.upsert() overwrites existing file records and inserts new ones', async (t) => {
  const {
    knex,
    collectionCumulusId,
    filePgModel,
    granuleCumulusId,
  } = t.context;

  const file = fakeFileRecordFactory({
    granule_cumulus_id: granuleCumulusId,
    collection_cumulus_id: collectionCumulusId,
    checksum_value: cryptoRandomString({ length: 3 }),
  });
  await filePgModel.create(knex, file);

  const updatedFile = {
    ...file,
    checksum_value: cryptoRandomString({ length: 3 }),
  };
  const additionalFiles = Array.from({ length: 10 }, () =>
    fakeFileRecordFactory({
      granule_cumulus_id: granuleCumulusId,
      collection_cumulus_id: collectionCumulusId,
    }));
  additionalFiles.push(updatedFile);

  const result = await filePgModel.upsert(knex, additionalFiles);
  t.is(result.length, 11);

  t.like(
    await filePgModel.get(knex, {
      bucket: file.bucket,
      key: file.key,
    }),
    updatedFile
  );
});

test('FilePgModel.upsert() creates no file records if input file list is empty', async (t) => {
  const {
    knex,
    filePgModel,
  } = t.context;

  const result = await filePgModel.upsert(knex, []);
  t.is(result.length, 0);
});

test('FilePgModel.searchByGranuleCumulusIds() returns relevant files', async (t) => {
  const usedGranules = await Promise.all(range(5).map(() => (
    createFakeGranule(t.context.knex)
  )));
  const unUsedGranules = await Promise.all(range(5).map(() => (
    createFakeGranule(t.context.knex)
  )));
  const relevantFiles = await t.context.filePgModel.insert(
    t.context.knex,
    usedGranules.map((granule) => (
      fakeFileRecordFactory({
        granule_cumulus_id: granule.cumulus_id,
        collection_cumulus_id: granule.collection_cumulus_id,
      })
    ))
  );
  const irrelevantFiles = await t.context.filePgModel.insert(
    t.context.knex,
    unUsedGranules.map((granule) => (
      fakeFileRecordFactory({
        granule_cumulus_id: granule.cumulus_id,
        collection_cumulus_id: granule.collection_cumulus_id,
      })
    ))
  );
  const searched = await t.context.filePgModel.searchByGranuleCumulusIds(
    t.context.knex,
    usedGranules.map((g) => g.cumulus_id)
  );

  const foundFileCumulusIds = searched.map((file) => file.cumulus_id);
  const foundGranuleCumulusIds = searched.map((file) => file.granule_cumulus_id);
  relevantFiles.forEach((relevantFile) => {
    t.true(foundFileCumulusIds.includes(relevantFile.cumulus_id));
  });
  irrelevantFiles.forEach((irrelevantFile) => {
    t.false(foundFileCumulusIds.includes(irrelevantFile.cumulus_id));
  });
  usedGranules.forEach((usedGranule) => {
    t.true(foundGranuleCumulusIds.includes(usedGranule.cumulus_id));
  });
  unUsedGranules.forEach((unUsedGranule) => {
    t.false(foundGranuleCumulusIds.includes(unUsedGranule.cumulus_id));
  });
});

test('FilePgModel.searchByGranuleCumulusIds() allows to specify desired columns', async (t) => {
  const usedGranules = await Promise.all(range(5).map(() => (
    createFakeGranule(t.context.knex)
  )));
  const unUsedGranules = await Promise.all(range(5).map(() => (
    createFakeGranule(t.context.knex)
  )));
  const relevantFiles = await t.context.filePgModel.insert(
    t.context.knex,
    usedGranules.map((granule) => (
      fakeFileRecordFactory({
        granule_cumulus_id: granule.cumulus_id,
        collection_cumulus_id: granule.collection_cumulus_id,
      })
    ))
  );
  const irrelevantFiles = await t.context.filePgModel.insert(
    t.context.knex,
    unUsedGranules.map((granule) => (
      fakeFileRecordFactory({
        granule_cumulus_id: granule.cumulus_id,
        collection_cumulus_id: granule.collection_cumulus_id,
      })
    ))
  );
  let searched = await t.context.filePgModel.searchByGranuleCumulusIds(
    t.context.knex,
    usedGranules.map((granule) => granule.cumulus_id),
    'cumulus_id'
  );

  searched.forEach((file) => {
    t.true(file.granule_cumulus_id === undefined);
    t.true(file.created_at === undefined);
    t.true(file.updated_at === undefined);
    t.true(file.file_size === undefined);
    t.true(file.bucket === undefined);
    t.true(file.checksum_type === undefined);
    t.true(file.checksum_value === undefined);
    t.true(file.file_name === undefined);
    t.true(file.key === undefined);
    t.true(file.path === undefined);
    t.true(file.source === undefined);
    t.true(file.type === undefined);
  });

  let foundFileCumulusIds = searched.map((file) => file.cumulus_id);
  relevantFiles.forEach((relevantFile) => {
    t.true(foundFileCumulusIds.includes(relevantFile.cumulus_id));
  });
  irrelevantFiles.forEach((irrelevantFile) => {
    t.false(foundFileCumulusIds.includes(irrelevantFile.cumulus_id));
  });

  searched = await t.context.filePgModel.searchByGranuleCumulusIds(
    t.context.knex,
    usedGranules.map((granule) => granule.cumulus_id),
    ['cumulus_id', 'granule_cumulus_id']
  );

  searched.forEach((file) => {
    t.true(file.created_at === undefined);
    t.true(file.updated_at === undefined);
    t.true(file.file_size === undefined);
    t.true(file.bucket === undefined);
    t.true(file.checksum_type === undefined);
    t.true(file.checksum_value === undefined);
    t.true(file.file_name === undefined);
    t.true(file.key === undefined);
    t.true(file.path === undefined);
    t.true(file.source === undefined);
    t.true(file.type === undefined);
  });

  foundFileCumulusIds = searched.map((file) => file.cumulus_id);
  const foundGranuleCumulusIds = searched.map((file) => file.granule_cumulus_id);
  relevantFiles.forEach((relevantFile) => {
    t.true(foundFileCumulusIds.includes(relevantFile.cumulus_id));
  });
  irrelevantFiles.forEach((irrelevantFile) => {
    t.false(foundFileCumulusIds.includes(irrelevantFile.cumulus_id));
  });

  usedGranules.forEach((usedGranule) => {
    t.true(foundGranuleCumulusIds.includes(usedGranule.cumulus_id));
  });
  unUsedGranules.forEach((unUsedGranule) => {
    t.false(foundGranuleCumulusIds.includes(unUsedGranule.cumulus_id));
  });
});

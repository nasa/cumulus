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
  const granuleCumulusId = pgGranule.cumulus_id;
  // bigint for granule cumulus_id is treated as a string,
  // not number, by knex
  // see https://github.com/knex/knex/issues/387
  return granuleCumulusId;
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

test('FilePgModel.searchByGranuleCumulusIds() returns relevant files', async (t) => {
  const usedGranuleCumulusIds = await Promise.all(range(5).map(() => (
    createFakeGranule(t.context.knex)
  )));
  const unUsedGranuleCumulusIds = await Promise.all(range(5).map(() => (
    createFakeGranule(t.context.knex)
  )));
  const relevantFiles = await t.context.filePgModel.insert(
    t.context.knex,
    usedGranuleCumulusIds.map((granuleCumulusId) => (
      fakeFileRecordFactory({
        granule_cumulus_id: granuleCumulusId
      })
    ))
  );
  const irrelevantFiles = await t.context.filePgModel.insert(
    t.context.knex,
    unUsedGranuleCumulusIds.map((granuleCumulusId) => (
      fakeFileRecordFactory({
        granule_cumulus_id: granuleCumulusId
      })
    ))
  );
  const searched = await t.context.filePgModel.searchByGranuleCumulusIds(
    t.context.knex,
    usedGranuleCumulusIds,
  );
  
  const foundFileCumulusIds = searched.map((file) => file.cumulus_id);
  const foundGranuleCumulusIds = searched.map((file) => file.granule_cumulus_id);
  relevantFiles.forEach((relevantFile) => {
    t.true(foundFileCumulusIds.includes(relevantFile.cumulus_id));
  })
  irrelevantFiles.forEach((irrelevantFile) => {
    t.false(foundFileCumulusIds.includes(irrelevantFile.cumulus_id));
  })
  usedGranuleCumulusIds.forEach((usedGranuleCumulusId) => {
    t.true(foundGranuleCumulusIds.includes(usedGranuleCumulusId));
  })
  unUsedGranuleCumulusIds.forEach((unUsedGranuleCumulusId) => {
    t.false(foundGranuleCumulusIds.includes(unUsedGranuleCumulusId));
  })
});

test('FilePgModel.searchByGranuleCumulusIds() allows to specify desired columns', async (t) => {
  const usedGranuleCumulusIds = await Promise.all(range(5).map(() => (
    createFakeGranule(t.context.knex)
  )));
  const unUsedGranuleCumulusIds = await Promise.all(range(5).map(() => (
    createFakeGranule(t.context.knex)
  )));
  const relevantFiles = await t.context.filePgModel.insert(
    t.context.knex,
    usedGranuleCumulusIds.map((granuleCumulusId) => (
      fakeFileRecordFactory({
        granule_cumulus_id: granuleCumulusId
      })
    ))
  );
  let irrelevantFiles = await t.context.filePgModel.insert(
    t.context.knex,
    unUsedGranuleCumulusIds.map((granuleCumulusId) => (
      fakeFileRecordFactory({
        granule_cumulus_id: granuleCumulusId
      })
    ))
  );
  let searched = await t.context.filePgModel.searchByGranuleCumulusIds(
    t.context.knex,
    usedGranuleCumulusIds,
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
  })
  irrelevantFiles.forEach((irrelevantFile) => {
    t.false(foundFileCumulusIds.includes(irrelevantFile.cumulus_id));
  })

  searched = await t.context.filePgModel.searchByGranuleCumulusIds(
    t.context.knex,
    usedGranuleCumulusIds,
    ['cumulus_id','granule_cumulus_id']
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
  })
  irrelevantFiles.forEach((irrelevantFile) => {
    t.false(foundFileCumulusIds.includes(irrelevantFile.cumulus_id));
  })

  usedGranuleCumulusIds.forEach((usedGranuleCumulusId) => {
    t.true(foundGranuleCumulusIds.includes(usedGranuleCumulusId));
  })
  unUsedGranuleCumulusIds.forEach((unUsedGranuleCumulusId) => {
    t.false(foundGranuleCumulusIds.includes(unUsedGranuleCumulusId));
  })
});

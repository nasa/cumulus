const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const { constructCollectionId } = require('@cumulus/message/Collections');
const {
  generateLocalTestDb,
  destroyLocalTestDb,
  FilePgModel,
  GranulePgModel,
  CollectionPgModel,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  getFilesAndGranuleInfoQuery,
  getGranuleIdAndCollectionIdFromFile,
  migrationDir,
  fakeProviderRecordFactory,
  ProviderPgModel,
} = require('../../dist');

const randomBucketName = () => `bucket-${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  t.context.testDbName = `file_${cryptoRandomString({ length: 10 })}`;

  const { knexAdmin, knex } = await generateLocalTestDb(
    t.context.testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.providerPgModel = new ProviderPgModel();
  t.context.collectionPgModel = new CollectionPgModel();
  t.context.filePgModel = new FilePgModel();
  t.context.granulePgModel = new GranulePgModel();

  const testProvider = fakeProviderRecordFactory({});
  const [pgProvider] = await t.context.providerPgModel.create(
    t.context.knex,
    testProvider
  );
  t.context.provider_cumulus_id = pgProvider.cumulus_id;
  t.context.providerName = testProvider.name;

  const testCollection = fakeCollectionRecordFactory();
  const [pgCollection] = await t.context.collectionPgModel.create(
    t.context.knex,
    testCollection
  );

  const testCollection2 = fakeCollectionRecordFactory();
  const [pgCollection2] = await t.context.collectionPgModel.create(
    t.context.knex,
    testCollection2
  );
  t.context.collections = [pgCollection, pgCollection2];
  t.context.collectionCumulusId = pgCollection.cumulus_id;
});

test.after.always(async (t) => {
  await destroyLocalTestDb(t.context);
});

test('getGranuleIdAndCollectionIdFromFile returns expected values', async (t) => {
  const { collectionCumulusId, filePgModel, knex } = t.context;

  const testGranule1 = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });
  const [pgGranule1] = await t.context.granulePgModel.create(
    t.context.knex,
    testGranule1
  );
  const granuleCumulusId1 = pgGranule1.cumulus_id;

  const testGranule2 = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });
  const [pgGranule2] = await t.context.granulePgModel.create(
    t.context.knex,
    testGranule2
  );
  const granuleCumulusId2 = pgGranule2.cumulus_id;

  const bucket = randomBucketName();
  const firstKey = `a_${cryptoRandomString({ length: 10 })}`;
  await filePgModel.create(knex, {
    bucket,
    key: firstKey,
    granule_cumulus_id: granuleCumulusId1,
  });
  const secondKey = `b_${cryptoRandomString({ length: 10 })}`;
  await filePgModel.create(knex, {
    bucket,
    key: secondKey,
    granule_cumulus_id: granuleCumulusId2,
  });

  const result = await getGranuleIdAndCollectionIdFromFile({
    knex,
    bucket,
    key: firstKey,
  });
  t.is(result.granule_id, testGranule1.granule_id);
  t.is(
    constructCollectionId(result.collection_name, result.collection_version),
    constructCollectionId(t.context.collections[0].name, t.context.collections[0].version)
  );
});

test('getFilesAndGranuleInfoQuery returns expected records', async (t) => {
  const { collectionCumulusId, filePgModel, knex } = t.context;

  const testGranule1 = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });
  const [pgGranule1] = await t.context.granulePgModel.create(
    t.context.knex,
    testGranule1
  );
  const granuleCumulusId1 = pgGranule1.cumulus_id;

  const testGranule2 = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });
  const [pgGranule2] = await t.context.granulePgModel.create(
    t.context.knex,
    testGranule2
  );
  const granuleCumulusId2 = pgGranule2.cumulus_id;

  const bucket = randomBucketName();
  const firstKey = `a_${cryptoRandomString({ length: 10 })}`;
  await filePgModel.create(knex, {
    bucket,
    key: firstKey,
    granule_cumulus_id: granuleCumulusId1,
  });
  const secondKey = `b_${cryptoRandomString({ length: 10 })}`;
  await filePgModel.create(knex, {
    bucket,
    key: secondKey,
    granule_cumulus_id: granuleCumulusId2,
  });

  const records = await getFilesAndGranuleInfoQuery({
    knex,
    searchParams: { bucket },
    sortColumns: ['bucket', 'key'],
    granuleColumns: ['granule_id'],
  });
  t.is(records.length, 2);
  t.like(records[0], {
    bucket,
    key: firstKey,
    granule_cumulus_id: granuleCumulusId1,
    granule_id: testGranule1.granule_id,
  });
  t.like(records[1], {
    bucket,
    key: secondKey,
    granule_cumulus_id: granuleCumulusId2,
    granule_id: testGranule2.granule_id,
  });
});

test('getFilesAndGranuleInfoQuery works with no granule columns specified', async (t) => {
  const { collectionCumulusId, filePgModel, knex } = t.context;

  const testGranule1 = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });
  const [pgGranule1] = await t.context.granulePgModel.create(
    t.context.knex,
    testGranule1
  );
  const granuleCumulusId1 = pgGranule1.cumulus_id;

  const bucket = randomBucketName();
  const firstKey = `a_${cryptoRandomString({ length: 10 })}`;
  await filePgModel.create(knex, {
    bucket,
    key: firstKey,
    granule_cumulus_id: granuleCumulusId1,
  });

  const records = await getFilesAndGranuleInfoQuery({
    knex,
    searchParams: { bucket },
    sortColumns: ['bucket', 'key'],
  });
  t.is(records.length, 1);
  t.like(records[0], {
    bucket,
    key: firstKey,
    granule_cumulus_id: granuleCumulusId1,
  });
});

test('getFilesAndGranuleInfoQuery filters on GranuleIds', async (t) => {
  const { collectionCumulusId, filePgModel, knex } = t.context;

  const testGranule1 = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });
  const [pgGranule1] = await t.context.granulePgModel.create(
    t.context.knex,
    testGranule1
  );
  const granuleCumulusId1 = pgGranule1.cumulus_id;

  const testGranule2 = fakeGranuleRecordFactory({
    collection_cumulus_id: collectionCumulusId,
  });
  const [pgGranule2] = await t.context.granulePgModel.create(
    t.context.knex,
    testGranule2
  );
  const granuleCumulusId2 = pgGranule2.cumulus_id;

  const bucket = randomBucketName();
  const firstKey = `a_${cryptoRandomString({ length: 10 })}`;
  await filePgModel.create(knex, {
    bucket,
    key: firstKey,
    granule_cumulus_id: granuleCumulusId1,
  });
  const secondKey = `b_${cryptoRandomString({ length: 10 })}`;
  await filePgModel.create(knex, {
    bucket,
    key: secondKey,
    granule_cumulus_id: granuleCumulusId2,
  });

  const records = await getFilesAndGranuleInfoQuery({
    knex,
    searchParams: { bucket },
    sortColumns: ['bucket', 'key'],
    granuleColumns: ['granule_id'],
    granuleIds: [testGranule2.granule_id],
  });
  t.is(records.length, 1);
  t.like(records[0], {
    bucket,
    key: secondKey,
    granule_cumulus_id: granuleCumulusId2,
    granule_id: testGranule2.granule_id,
  });
});

test('getFilesAndGranuleInfoQuery filters on collectionIds', async (t) => {
  const { collections, filePgModel, knex } = t.context;

  const testGranule1 = fakeGranuleRecordFactory({
    collection_cumulus_id: collections[0].cumulus_id,
  });
  const [pgGranule1] = await t.context.granulePgModel.create(
    t.context.knex,
    testGranule1
  );

  const testGranule2 = fakeGranuleRecordFactory({
    collection_cumulus_id: collections[1].cumulus_id,
  });
  const [pgGranule2] = await t.context.granulePgModel.create(
    t.context.knex,
    testGranule2
  );
  const collection2Id = constructCollectionId(
    collections[1].name,
    collections[1].version
  );

  const bucket = randomBucketName();
  const firstKey = `a_${cryptoRandomString({ length: 10 })}`;
  await filePgModel.create(knex, {
    bucket,
    key: firstKey,
    granule_cumulus_id: pgGranule1.cumulus_id,
  });

  const secondKey = `b_${cryptoRandomString({ length: 10 })}`;
  await filePgModel.create(knex, {
    bucket,
    key: secondKey,
    granule_cumulus_id: pgGranule2.cumulus_id,
  });

  const records = await getFilesAndGranuleInfoQuery({
    knex,
    searchParams: { bucket },
    sortColumns: ['bucket', 'key'],
    granuleColumns: ['granule_id'],
    collectionIds: [collection2Id],
  });

  t.is(records.length, 1);
  t.like(records[0], {
    bucket,
    key: secondKey,
    granule_cumulus_id: pgGranule2.cumulus_id,
    granule_id: testGranule2.granule_id,
  });
});

test('getFilesAndGranuleInfoQuery filters on providers', async (t) => {
  const { collections, filePgModel, knex } = t.context;

  const testGranule1 = fakeGranuleRecordFactory({
    collection_cumulus_id: collections[0].cumulus_id,
  });
  const [pgGranule1] = await t.context.granulePgModel.create(
    t.context.knex,
    testGranule1
  );

  const testGranule2 = fakeGranuleRecordFactory({
    collection_cumulus_id: collections[1].cumulus_id,
    provider_cumulus_id: t.context.provider_cumulus_id,
  });
  const [pgGranule2] = await t.context.granulePgModel.create(
    t.context.knex,
    testGranule2
  );

  const bucket = randomBucketName();
  const firstKey = `a_${cryptoRandomString({ length: 10 })}`;
  await filePgModel.create(knex, {
    bucket,
    key: firstKey,
    granule_cumulus_id: pgGranule1.cumulus_id,
  });

  const secondKey = `b_${cryptoRandomString({ length: 10 })}`;
  await filePgModel.create(knex, {
    bucket,
    key: secondKey,
    granule_cumulus_id: pgGranule2.cumulus_id,
  });

  const records = await getFilesAndGranuleInfoQuery({
    knex,
    searchParams: { bucket },
    sortColumns: ['bucket', 'key'],
    granuleColumns: ['granule_id'],
    providers: [t.context.providerName],
  });

  t.is(records.length, 1);
  t.like(records[0], {
    bucket,
    key: secondKey,
    granule_cumulus_id: pgGranule2.cumulus_id,
    granule_id: testGranule2.granule_id,
  });
});

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');

const { constructCollectionId } = require('@cumulus/message/Collections');
const {
  CollectionPgModel,
  GranulePgModel,
  FilePgModel,
  generateLocalTestDb,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeFileRecordFactory,
  fakeGranuleRecordFactory,
  getUniqueGranuleByGranuleId,
  migrationDir,
  updateGranuleAndFiles,
  translatePostgresGranuleResultToApiGranule,
  translatePostgresCollectionToApiCollection,
} = require('../../dist');

const testDbName = `granule_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.granulePgModel = new GranulePgModel();
  t.context.collectionPgModel = new CollectionPgModel();
  t.context.filePgModel = new FilePgModel();

  // set up 2 collections
  t.context.collection = fakeCollectionRecordFactory();
  t.context.collection2 = fakeCollectionRecordFactory();
  t.context.collectionId = constructCollectionId(
    t.context.collection.name,
    t.context.collection.version
  );
  t.context.collectionId2 = constructCollectionId(
    t.context.collection2.name,
    t.context.collection2.version
  );
  const collectionResponse = await t.context.collectionPgModel.create(
    t.context.knex,
    t.context.collection
  );
  const collectionResponse2 = await t.context.collectionPgModel.create(
    t.context.knex,
    t.context.collection2
  );
  t.context.collectionCumulusId = collectionResponse[0].cumulus_id;
  t.context.collectionCumulusId2 = collectionResponse2[0].cumulus_id;
  t.context.apiCollection1 = translatePostgresCollectionToApiCollection(collectionResponse[0]);
  t.context.apiCollection2 = translatePostgresCollectionToApiCollection(collectionResponse2[0]);

  // create 10 granules in one collection, 0 in the other
  t.context.granuleIds = range(10).map((num) => 'granuleId___' + num);

  t.context.granulePgModel = new GranulePgModel();
  t.context.granules = range(10).map((num) => fakeGranuleRecordFactory({
    granule_id: t.context.granuleIds[num],
    collection_cumulus_id: t.context.collectionCumulusId,
    cumulus_id: num,
  }));
  t.context.pgGranules = await t.context.granulePgModel.insert(
    knex,
    t.context.granules
  );

  t.context.postMoveApiGranules = [];

  t.context.files = [];
  // create fake files for each of the ten granules (3 per granule)
  for (const pgGranule of t.context.granules) {
    t.context.files.push(
      fakeFileRecordFactory({
        granule_cumulus_id: pgGranule.cumulus_id,
        file_name: pgGranule.granule_id + '.hdf',
        updated_at: new Date().toISOString(),
        bucket: t.context.collectionId + '--bucket',
        key: t.context.collectionId + pgGranule.granule_id + '/key-hdf.pem',
        path: t.context.collectionId + '/' + pgGranule.granule_id,
      }),
      fakeFileRecordFactory({
        granule_cumulus_id: pgGranule.cumulus_id,
        file_name: pgGranule.granule_id + '.txt',
        updated_at: new Date().toISOString(),
        bucket: t.context.collectionId + '--bucket',
        key: t.context.collectionId + pgGranule.granule_id + '/key-txt.pem',
        path: t.context.collectionId + '/' + pgGranule.granule_id,
      }),
      fakeFileRecordFactory({
        granule_cumulus_id: pgGranule.cumulus_id,
        file_name: pgGranule.granule_id + '.cmr',
        updated_at: new Date().toISOString(),
        bucket: t.context.collectionId + '--bucket',
        key: t.context.collectionId + pgGranule.granule_id + '/key-cmr.pem',
        path: t.context.collectionId + '/' + pgGranule.granule_id,
      })
    );
  }

  t.context.pgFiles = await t.context.filePgModel.insert(knex, t.context.files);

  // this loop initiates the changes that the task would perform upon the records before updating PG
  /* eslint-disable no-await-in-loop */
  for (const granule of t.context.granules) {
    const postMoveApiGranule = await translatePostgresGranuleResultToApiGranule(t.context.knex, {
      ...granule,
      collectionName: t.context.collection.name,
      collectionVersion: t.context.collection.version,
    });
    postMoveApiGranule.collectionId = t.context.collectionId2;
    postMoveApiGranule.updatedAt = Date.now();
    postMoveApiGranule.lastUpdateDateTime = new Date().toISOString();
    for (const apiFile of postMoveApiGranule.files) {
      apiFile.bucket = apiFile.bucket.replace(t.context.collectionId, t.context.collectionId2);
      apiFile.key = apiFile.key.replace(t.context.collectionId, t.context.collectionId2);
      //apiFile.path = apiFile.path.replace(t.context.collectionId, t.context.collectionId2);
      apiFile.updatedAt = Date.now();
    }
    t.context.postMoveApiGranules.push(postMoveApiGranule);
  }
  /* eslint-enable no-await-in-loop */
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('updateGranuleAndFiles successfully updates a list of granules based on the collectionId change', async (t) => {
  const {
    granuleIds,
    granulePgModel,
    postMoveApiGranules,
    collectionId2,
    knex,
  } = t.context;
  await updateGranuleAndFiles(knex, postMoveApiGranules);

  const returnedGranules = await Promise.all(granuleIds.map((id) =>
    getUniqueGranuleByGranuleId(knex, id, granulePgModel)));

  /* eslint-disable no-await-in-loop */
  for (const granule of returnedGranules) {
    const apiGranule = await translatePostgresGranuleResultToApiGranule(t.context.knex, {
      ...granule,
      collectionName: t.context.collection2.name,
      collectionVersion: t.context.collection2.version,
    });
    t.true(apiGranule.collectionId === collectionId2);
    for (const file of apiGranule.files) {
      t.true(file.key.includes(collectionId2));
      t.true(file.bucket.includes(collectionId2));
    }
  }
  /* eslint-enable no-await-in-loop */
});

// need to write some failure cases (? if neccessary)

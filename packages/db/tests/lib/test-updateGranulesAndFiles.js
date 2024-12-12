/* eslint-disable no-await-in-loop */
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');

const { constructCollectionId } = require('@cumulus/message/Collections');
const {
  CollectionPgModel,
  FilePgModel,
  GranulePgModel,
  migrationDir,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeFileRecordFactory,
  fakeGranuleRecordFactory,
  generateLocalTestDb,
  getUniqueGranuleByGranuleId,
  translatePostgresCollectionToApiCollection,
  translatePostgresGranuleResultToApiGranule,
  updateGranulesAndFiles,
} = require('../../dist');

const testDbName = `granule_${cryptoRandomString({ length: 10 })}`;

/**
 * Simulate granule records post-collection-move for database updates test
 *
 * @param {Knex | Knex.Transaction} knexOrTransaction - DB client or transaction
 * @param {Array<Object>} [granules] - granule records to update
 * @param {Object} [collection] - current collection of granules used for translation
 * @param {string} [collectionId] - collectionId of current granules
 * @param {string} [collectionId2] - collectionId of collection that the granule is moving to
 * @returns {Array<Object>} - list of updated apiGranules (moved to new collection)
 */
const simulateGranuleUpdate = async (knex, granules, collection, collectionId, collectionId2) => {
  const movedGranules = [];
  for (const granule of granules) {
    const postMoveApiGranule = await translatePostgresGranuleResultToApiGranule(knex, {
      ...granule,
      collectionName: collection.name,
      collectionVersion: collection.version,
    });
    postMoveApiGranule.collectionId = collectionId2;
    postMoveApiGranule.updatedAt = Date.now();
    postMoveApiGranule.lastUpdateDateTime = new Date().toISOString();
    for (const apiFile of postMoveApiGranule.files) {
      apiFile.bucket = apiFile.bucket.replace(collectionId, collectionId2);
      apiFile.key = apiFile.key.replace(collectionId, collectionId2);
      apiFile.updatedAt = Date.now();
    }
    movedGranules.push(postMoveApiGranule);
  }
  return movedGranules;
};

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

  t.context.movedGranules = [];

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
  // update 1/2 of the granules to be moved to the new collection
  t.context.movedGranules.push(await simulateGranuleUpdate(knex, t.context.granules.slice(0, 5),
    t.context.collection, t.context.collectionId, t.context.collectionId2));

  // the other half will be unmoved but translated to an apiGranule
  t.context.movedGranules.push(await simulateGranuleUpdate(knex, t.context.granules.slice(5),
    t.context.collection, t.context.collectionId, t.context.collectionId));

  t.context.movedGranules = t.context.movedGranules.flat();
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test.serial('updateGranulesAndFiles successfully updates a partial list of granules based on the collectionId change', async (t) => {
  const {
    granuleIds,
    granulePgModel,
    movedGranules,
    collectionId2,
    collectionId,
    collection,
    collection2,
    knex,
  } = t.context;
  await updateGranulesAndFiles(knex, movedGranules);

  const returnedGranules = await Promise.all(granuleIds.map((id) =>
    getUniqueGranuleByGranuleId(knex, id, granulePgModel)));

  for (const granule of returnedGranules) {
    const testCollection = granule.cumulus_id >= 5 ? collection : collection2;
    const testCollectionId = granule.cumulus_id >= 5 ? collectionId : collectionId2;
    const apiGranule = await translatePostgresGranuleResultToApiGranule(knex, {
      ...granule,
      collectionName: testCollection.name,
      collectionVersion: testCollection.version,
    });
    // the movedGranules param only has 1/2 of the granules to be moved to collection 2
    // here we can check based on the granule's cumulus id which collection it should be a part of
    t.true(apiGranule.collectionId === testCollectionId);
    for (const file of apiGranule.files) {
      t.true(file.key.includes(testCollectionId));
      t.true(file.bucket.includes(testCollectionId));
    }
  }
});

test.serial('updateGranulesAndFiles successfully updates a complete list of granules, 1/2 of which have already been moved', async (t) => {
  const {
    granuleIds,
    granulePgModel,
    granules,
    movedGranules,
    collectionId2,
    collectionId,
    collection,
    collection2,
    knex,
  } = t.context;
  // the remaining granules of movedGranules in collection 1 will need to be updated to collection 2
  movedGranules.splice(-5);
  movedGranules.push(await simulateGranuleUpdate(knex, granules.slice(5), collection,
    collectionId, collectionId2));

  const testPostMoveApiGranules = movedGranules.flat();
  await updateGranulesAndFiles(knex, testPostMoveApiGranules);

  const returnedGranules = await Promise.all(granuleIds.map((id) =>
    getUniqueGranuleByGranuleId(knex, id, granulePgModel)));

  for (const granule of returnedGranules) {
    const apiGranule = await translatePostgresGranuleResultToApiGranule(knex, {
      ...granule,
      collectionName: collection2.name,
      collectionVersion: collection2.version,
    });
    // now every granule should be part of collection 2
    t.true(apiGranule.collectionId === collectionId2);
    for (const file of apiGranule.files) {
      t.true(file.key.includes(collectionId2));
      t.true(file.bucket.includes(collectionId2));
    }
  }
});

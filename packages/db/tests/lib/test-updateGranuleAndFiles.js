const test = require('ava');
const sinon = require('sinon');
const cryptoRandomString = require('crypto-random-string');
const orderBy = require('lodash/orderBy');
const range = require('lodash/range');

const { RecordDoesNotExist } = require('@cumulus/errors');
const { constructCollectionId, deconstructCollectionId } = require('@cumulus/message/Collections');
const {
  CollectionPgModel,
  GranulePgModel,
  FilePgModel,
  generateLocalTestDb,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeFileRecordFactory,
  fakeGranuleRecordFactory,
  getGranulesByGranuleId,
  getUniqueGranuleByGranuleId,
  getGranuleByUniqueColumns,
  migrationDir,
  getGranulesByApiPropertiesQuery,
  createRejectableTransaction,
  updateGranuleAndFiles
} = require('../../dist');

const testDbName = `granule_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
// create fake files
// try to call the function and then test the database for the output
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
  )
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

  // create 10 granules in one collection, 0 in the other
  t.context.granuleIds = range(10).map(num => 'granuleId___' + num);

  t.context.granulePgModel = new GranulePgModel();
  t.context.pgGranules = await t.context.granulePgModel.insert(
    knex,
    range(10).map((num) => fakeGranuleRecordFactory({
      granule_id: t.context.granuleIds[num],
      collection_cumulus_id: t.context.collectionCumulusId
    }))
  );
  t.context.pgFiles = [];
  // create fake files for each of the ten granules (3 per granule)
  for(pgGranule of t.context.pgGranules){
    t.context.pgFiles.push(
      fakeFileRecordFactory({
        granule_cumulus_id: pgGranule.cumulus_id,
        file_name: pgGranule.granule_id + '.hdf',
        updated_at: new Date().toISOString(),
      }),
      fakeFileRecordFactory({
        granule_cumulus_id: pgGranule.cumulus_id,
        file_name: pgGranule.granule_id + '.txt',
        updated_at: new Date().toISOString(),
      }),
      fakeFileRecordFactory({
        granule_cumulus_id: pgGranule.cumulus_id,
        file_name: pgGranule.granule_id + '.cmr',
        updated_at: new Date().toISOString(),
      })
    );
  }
  await t.context.filePgModel.insert(knex, t.context.pgFiles);
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('updateGranuleAndFiles successfully updates a granule based on the collectionId change', async (t) => {
  const {
    collectionCumulusId2,
    collectionId2,
    granuleIds,
    knex,
    collectionPgModel,
    granulePgModel,
    filePgModel,
    pgFiles,
  } = t.context;
  const granuleIdsSplit = granuleIds.slice(0,5);
  await updateGranuleAndFiles(knex, collectionPgModel, granuleIdsSplit, collectionId2);
  const returnedGranules = await Promise.all(granuleIdsSplit.map((id) => getUniqueGranuleByGranuleId(knex, id, granulePgModel)));
  const collectionCumulusIds = returnedGranules.map(granule => granule.collection_cumulus_id);
  t.deepEqual(collectionCumulusIds, Array(5).fill(collectionCumulusId2));
  const returnedFiles = await Promise.all(returnedGranules.map((obj) => filePgModel.search(knex, {
    granule_cumulus_id: obj.cumulus_id,
  })));
  let x = 0;
  for(let i = 0; i < returnedFiles.length; i++){
    for(let j = 0; j < returnedFiles[i].length && x < pgFiles.slice(0,15).length; j++){
      t.true(new Date(returnedFiles[i][j].updated_at) > new Date(pgFiles[x].updated_at))
      x++;
    }
  }
});

// write some failure cases
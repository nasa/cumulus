/* eslint-disable no-await-in-loop */
const test = require('ava');
const range = require('lodash/range');

const cryptoRandomString = require('crypto-random-string');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeFileRecordFactory,
  fakeGranuleRecordFactory,
  FilePgModel,
  generateLocalTestDb,
  getUniqueGranuleByGranuleId,
  GranulePgModel,
  localStackConnectionEnv,
  migrationDir,
  translatePostgresCollectionToApiCollection,
  translatePostgresGranuleResultToApiGranule,
} = require('@cumulus/db');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
  s3PutObject,
} = require('@cumulus/aws-client/S3');
const { createSnsTopic } = require('@cumulus/aws-client/SNS');
const indexer = require('@cumulus/es-client/indexer');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');
const { randomString, randomId } = require('@cumulus/common/test-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');
const models = require('../../models');

const { request } = require('../helpers/request');

// Dynamo mock data factories
const {
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers,
} = require('../../lib/testUtils');

const testDbName = `granules_${cryptoRandomString({ length: 10 })}`;

let accessTokenModel;
let jwtAuthToken;

process.env.AccessTokensTable = randomId('token');
process.env.stackName = randomId('stackname');
process.env.system_bucket = randomId('system-bucket');
process.env.TOKEN_SECRET = randomId('secret');
process.env.backgroundQueueUrl = randomId('backgroundQueueUrl');

// import the express app after setting the env variables
const { app } = require('../../app');

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
  process.env.CMR_ENVIRONMENT = 'SIT';
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  const topicName = randomString();
  const { TopicArn } = await createSnsTopic(topicName);
  process.env.granule_sns_topic_arn = TopicArn;
  t.context.TopicArn = TopicArn;

  const { esIndex, esClient, searchClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.searchClient = searchClient;
  process.env.ES_INDEX = esIndex;

  // create a fake bucket
  await createBucket(process.env.system_bucket);

  // create a workflow template file
  const tKey = `${process.env.stackName}/workflow_template.json`;
  await s3PutObject({ Bucket: process.env.system_bucket, Key: tKey, Body: '{}' });

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.granulePgModel = new GranulePgModel();
  t.context.collectionPgModel = new CollectionPgModel();
  t.context.filePgModel = new FilePgModel();

  // set up 2 collections
  t.context.collection = fakeCollectionRecordFactory({ files: [] });
  t.context.collection2 = fakeCollectionRecordFactory({ files: [] });
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
  await indexer.indexCollection(esClient, t.context.collection, t.context.esIndex);
  const collectionResponse2 = await t.context.collectionPgModel.create(
    t.context.knex,
    t.context.collection2
  );
  await indexer.indexCollection(esClient, t.context.collection2, t.context.esIndex);
  t.context.collectionCumulusId = collectionResponse[0].cumulus_id;
  t.context.collectionCumulusId2 = collectionResponse2[0].cumulus_id;
  t.context.apiCollection1 = translatePostgresCollectionToApiCollection(collectionResponse[0]);
  t.context.apiCollection2 = translatePostgresCollectionToApiCollection(collectionResponse2[0]);

  // create 10 granules in one collection, 0 in the other
  t.context.granuleIds = range(5).map((num) => 'granuleId___' + num);

  t.context.granulePgModel = new GranulePgModel();
  t.context.granules = range(5).map((num) => fakeGranuleRecordFactory({
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
  t.context.apiGranules = [];

  await esClient.client.indices.refresh({ index: t.context.esIndex });
  await Promise.all(t.context.granules.map(async (granule) => {
    const newGranule = await translatePostgresGranuleResultToApiGranule(knex, {
      ...granule,
      collectionName: t.context.collection.name,
      collectionVersion: t.context.collection.version,
    });
    t.context.apiGranules.push(newGranule);
    await indexer.indexGranule(esClient, newGranule, t.context.esIndex);
    await esClient.client.indices.refresh({ index: t.context.esIndex });
  }));

  // update all of the granules to be moved to the new collection
  t.context.movedGranules.push(await simulateGranuleUpdate(knex, t.context.granules,
    t.context.collection, t.context.collectionId, t.context.collectionId2));

  t.context.movedGranules = t.context.movedGranules.flat();
});

test.after.always(async (t) => {
  await accessTokenModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await cleanupTestIndex(t.context);
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test.serial('PATCH /granules/batchRecords successfully updates granules to new collectionId in PG and ES', async (t) => {
  const {
    granuleIds,
    granulePgModel,
    apiGranules,
    collectionId2,
    collection2,
    collectionCumulusId2,
    esIndex,
    esClient,
    knex,
  } = t.context;

  const params = {
    apiGranules: apiGranules,
    collectionId: collectionId2,
  };

  const response = await request(app)
    .patch('/granules/batchRecords')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(params)
    .expect(200);

  const { message } = response.body;
  t.true(message.includes('Successfully wrote granules'));
  const returnedGranules = await Promise.all(granuleIds.map((id) =>
    getUniqueGranuleByGranuleId(knex, id, granulePgModel)));

  for (const granule of returnedGranules) {
    t.is(granule.collection_cumulus_id, collectionCumulusId2);
    const apiGranule = await translatePostgresGranuleResultToApiGranule(knex, {
      ...granule,
      collectionName: collection2.name,
      collectionVersion: collection2.version,
    });
    const esGranule = await esClient.client.get({
      index: esIndex,
      type: 'granule',
      id: granule.granule_id,
      parent: apiGranule.collectionId,
    }).then((res) => res.body);

    t.is(apiGranule.collectionId, collectionId2);
    t.is(esGranule._source.collectionId, collectionId2);
  }
});

test.serial('PATCH /granules/batchPatch successfully updates a batch of granules', async (t) => {
  const {
    granuleIds,
    granulePgModel,
    movedGranules,
    collectionId2,
    collection2,
    collectionCumulusId2,
    esIndex,
    esClient,
    knex,
  } = t.context;

  const params = {
    apiGranules: movedGranules,
  };

  await request(app)
    .patch('/granules/batchPatch')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(params)
    .expect(200);

  const returnedGranules = await Promise.all(
    granuleIds.map((id) => getUniqueGranuleByGranuleId(knex, id, granulePgModel))
  );

  for (const granule of returnedGranules) {
    t.is(granule.collection_cumulus_id, collectionCumulusId2);
    const apiGranule = await translatePostgresGranuleResultToApiGranule(knex, {
      ...granule,
      collectionName: collection2.name,
      collectionVersion: collection2.version,
    });

    const esGranule = await esClient.client.get({
      index: esIndex,
      type: 'granule',
      id: granule.granule_id,
      parent: apiGranule.collectionId,
    }).then((res) => res.body);

    // now every granule should be part of collection 2
    t.is(apiGranule.collectionId, collectionId2);
    t.is(esGranule._source.collectionId, collectionId2);
    for (const file of apiGranule.files) {
      t.true(file.key.includes(collectionId2));
      t.true(file.bucket.includes(collectionId2));
    }
  }
});

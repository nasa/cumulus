'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  FilePgModel,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  fakeFileRecordFactory,
  generateLocalTestDb,
  GranulePgModel,
  localStackConnectionEnv,
  migrationDir,
} = require('@cumulus/db');

const { randomId } = require('@cumulus/common/test-utils');

const { constructCollectionId } = require('@cumulus/message/Collections');

const models = require('../../models');

const { request } = require('../helpers/request');

// Dynamo mock data factories
const testDbName = `granules_${cryptoRandomString({ length: 10 })}`;

let accessTokenModel;

process.env.AccessTokensTable = randomId('token');
process.env.stackName = randomId('stackname');
process.env.system_bucket = randomId('system-bucket');
process.env.TOKEN_SECRET = randomId('secret');
process.env.backgroundQueueUrl = randomId('backgroundQueueUrl');

// import the express app after setting the env variables
const { app } = require('../../app');

test.before(async () => {
  process.env.CMR_ENVIRONMENT = 'SIT';
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };
  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();
});

test.before(async (t) => {
  // Generate a local test postGres database
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  const granulePgModel = new GranulePgModel();
  const collectionPgModel = new CollectionPgModel();
  const filePgModel = new FilePgModel();
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;

  // Create collections in Postgres
  // we need this because a granule has a foreign key referring to collections
  t.context.collectionName = 'fakeCollection';
  t.context.collectionVersion = 'v1';

  t.context.collectionId = constructCollectionId(
    t.context.collectionName,
    t.context.collectionVersion
  );

  t.context.testPgCollection = fakeCollectionRecordFactory({
    name: t.context.collectionName,
    version: t.context.collectionVersion,
  });
  t.context.collectionPgModel = new CollectionPgModel();
  const [pgCollection] = await collectionPgModel.create(
    t.context.knex,
    t.context.testPgCollection
  );

  const granuleId1 = cryptoRandomString({ length: 7 });
  const timestamp = new Date();

  // create fake Postgres granule records
  const pgGranule = fakeGranuleRecordFactory({
    granule_id: granuleId1,
    producer_granule_id: granuleId1,
    status: 'completed',
    collection_cumulus_id: pgCollection.cumulus_id,
    published: true,
    cmr_link:
      'https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=A123456789-TEST_A',
    duration: 47.125,
    timestamp,
    updated_at: timestamp,
  });

  t.context.pgGranuleRecord = await granulePgModel.create(
    knex,
    pgGranule
  );

  t.context.fakePGFile = fakeFileRecordFactory({
    granule_cumulus_id: t.context.pgGranuleRecord[0].cumulus_id,
    file_name: t.context.pgGranuleRecord[0].granule_id + '.hdf',
    updated_at: new Date().toISOString(),
    bucket: t.context.collectionId,
    key: t.context.pgGranuleRecord[0].granule_id,
  });
  await filePgModel.create(
    t.context.knex,
    t.context.fakePGFile
  );
});

test.after(async (t) => {
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test('GET /granules/file returns granule and collection information for a file', async (t) => {
  const fileRecord = t.context.fakePGFile;
  process.env.auth_mode = 'private';
  const response = await request(app)
    .get(`/granules/file/${fileRecord.bucket}/${fileRecord.key}`)
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer fakeToken');
  t.is(response.statusCode, 200, 'response status code should be 200');
  t.is(response.body.granuleId, t.context.pgGranuleRecord[0].granule_id, 'granule_id should match');
  t.is(t.context.collectionId, response.body.collectionId, 'collection_id should match');
});

test('GET /granules/file returns 404 if file does not exist', async (t) => {
  const fileRecord = t.context.fakePGFile;
  process.env.auth_mode = 'private';
  const response = await request(app)
    .get(`/granules/file/${fileRecord.bucket}/${fileRecord.key}-not-found`)
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer fakeToken');
  t.is(response.statusCode, 404, 'response status code should be 404');
  const regexp = new RegExp(`No existing granule found for bucket: ${fileRecord.bucket} and key: ${fileRecord.key}-not-found`);
  t.regex(response.body.message, regexp, 'error message should match');
});

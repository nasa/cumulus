'use strict';

const test = require('ava');
const request = require('supertest');
const range = require('lodash/range');
const awsServices = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');
const { randomString } = require('@cumulus/common/test-utils');

const models = require('../../../models');
const {
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers,
} = require('../../../lib/testUtils');
const assertions = require('../../../lib/assertions');

process.env.AccessTokensTable = randomId('accessTokensTable');
process.env.stackName = randomId('stackName');
process.env.system_bucket = randomId('bucket');
process.env.TOKEN_SECRET = randomId('tokenSecret');

const testDbName = randomId('collection');

const {
  destroyLocalTestDb,
  generateLocalTestDb,
  CollectionPgModel,
  GranulePgModel,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  migrationDir,
  localStackConnectionEnv,
} = require('../../../../db/dist');

process.env.PG_HOST = randomId('hostname');
process.env.PG_USER = randomId('user');
process.env.PG_PASSWORD = randomId('password');

process.env.AccessTokensTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../../app');

let jwtAuthToken;
let accessTokenModel;

process.env = {
  ...process.env,
  ...localStackConnectionEnv,
  PG_DATABASE: testDbName,
};

test.before(async (t) => {
  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket });

  const username = randomId('username');
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );

  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.collectionPgModel = new CollectionPgModel();
  const collections = [];

  range(3).map((num) => (
    collections.push(fakeCollectionRecordFactory({
      name: `coll${num + 1}`,
      version: 1,
      cumulus_id: num,
      updated_at: num === 2 ? new Date(2020, 0, 29) : new Date(),
    }))
  ));

  t.context.granulePgModel = new GranulePgModel();
  const granules = [];

  range(2).map(() => (
    granules.push(fakeGranuleRecordFactory({
      collection_cumulus_id: 0,
    }))
  ));

  range(2).map((num) => (
    granules.push(fakeGranuleRecordFactory({
      collection_cumulus_id: 2,
      updated_at: new Date(2020, num, 29),
    }))
  ));

  t.context.collections = collections;
  await t.context.collectionPgModel.insert(
    t.context.knex,
    collections
  );

  t.context.granules = granules;
  await t.context.granulePgModel.insert(
    t.context.knex,
    granules
  );
});

test.after.always(async (t) => {
  await accessTokenModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/collections/active')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('GET without pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/collections/active')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.serial('default returns collections with granules', async (t) => {
  const response = await request(app)
    .get('/collections/active')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { results } = response.body;
  t.is(results.length, 2);
  t.deepEqual(results.map((r) => r.name), ['coll1', 'coll3']);
});

test.serial('timestamp__from filters collections by granule date', async (t) => {
  const fromDate = new Date(2020, 2, 1);

  const response = await request(app)
    .get(`/collections/active?timestamp__from=${fromDate.getTime()}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { results } = response.body;
  t.is(results.length, 1);
  t.is(results[0].name, 'coll1');
});

test.serial('timestamps filters collections by granule date', async (t) => {
  const fromDate = new Date(2020, 0, 1);
  const toDate = new Date(2020, 1, 1);

  const response = await request(app)
    .get(`/collections/active?timestamp__from=${fromDate.getTime()}&timestamp__to=${toDate.getTime()}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { results } = response.body;
  t.is(results.length, 1);
  t.is(results[0].name, 'coll3');
});

test.serial('timestamps filters collections and stats by granule date', async (t) => {
  const fromDate = new Date(2020, 0, 1);
  const toDate = new Date(2020, 1, 1);
  const toDate2 = new Date(2020, 2, 1);

  let response = await request(app)
    .get(`/collections/active?timestamp__from=${fromDate.getTime()}&timestamp__to=${toDate.getTime()}&includeStats=true`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  let results = response.body.results;
  t.is(results.length, 1);
  let { name, stats } = results[0];
  t.is(name, 'coll3');
  t.truthy(stats);
  t.is(stats.total, 1);

  response = await request(app)
    .get(`/collections/active?timestamp__from=${fromDate.getTime()}&timestamp__to=${toDate2.getTime()}&includeStats=true`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  results = response.body.results;
  t.is(results.length, 1);
  ({ name, stats } = results[0]);
  t.is(name, 'coll3');
  t.truthy(stats);
  t.is(stats.total, 2);
});

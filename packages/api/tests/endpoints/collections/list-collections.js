'use strict';

const test = require('ava');
const request = require('supertest');
const range = require('lodash/range');
const awsServices = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const { randomId } = require('@cumulus/common/test-utils');

const models = require('../../../models');
const {
  createFakeJwtAuthToken,
  fakeCollectionFactory,
  setAuthorizedOAuthUsers,
} = require('../../../lib/testUtils');
const assertions = require('../../../lib/assertions');

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
process.env.TOKEN_SECRET = randomString();

process.env.AccessTokensTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();

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

  const username = randomString();
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

  range(10).map((num) => (
    collections.push(fakeCollectionRecordFactory({
      name: num % 2 === 0 ? `testCollection__${num}` : `fakeCollection__${num}`,
      version: `${num}`,
      cumulus_id: num,
      updated_at: new Date(1579352700000 + (num % 2) * 1000),
    }))
  ));

  t.context.granulePgModel = new GranulePgModel();
  const granules = [];
  const statuses = ['queued', 'failed', 'completed', 'running'];

  range(100).map((num) => (
    granules.push(fakeGranuleRecordFactory({
      collection_cumulus_id: collections[num % 9].cumulus_id,
      status: statuses[num % 4],
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

test.beforeEach((t) => {
  t.context.testCollection = fakeCollectionFactory();
});

test.after.always(async (t) => {
  await accessTokenModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/collections')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 GET without pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/collections')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 GET without pathParameters and with an unauthorized user returns an unauthorized response');

test.serial('default returns list of collections from query', async (t) => {
  const response = await request(app)
    .get('/collections')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { results } = response.body;
  t.is(results.length, 10);
  t.is(results[0].name, t.context.collections[0].name);
});

test.serial('returns list of collections with stats when requested', async (t) => {
  const response = await request(app)
    .get('/collections?includeStats=true')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const expectedStats1 = { queued: 3, completed: 3, failed: 3, running: 3, total: 12 };
  const expectedStats2 = { queued: 2, completed: 3, failed: 3, running: 3, total: 11 };
  const expectedStats3 = { queued: 0, completed: 0, failed: 0, running: 0, total: 0 };

  const { results } = response.body;
  t.is(results.length, 10);
  t.is(results[0].name, t.context.collections[0].name);
  t.deepEqual(results[0].stats, expectedStats1);
  t.deepEqual(results[1].stats, expectedStats2);
  t.deepEqual(results[9].stats, expectedStats3);
});

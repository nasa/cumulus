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
  setAuthorizedOAuthUsers,
} = require('../../../lib/testUtils');
const assertions = require('../../../lib/assertions');
const testDbName = randomId('collection');

const {
  destroyLocalTestDb,
  generateLocalTestDb,
  CollectionPgModel,
  fakeCollectionRecordFactory,
  migrationDir,
  localStackConnectionEnv,
} = require('../../../../db/dist');

// import the express app after setting the env variables
const { app } = require('../../../app');
let jwtAuthToken;
let accessTokenModel;

process.env.PG_HOST = randomId('hostname');
process.env.PG_USER = randomId('user');
process.env.PG_PASSWORD = randomId('password');
process.env.TOKEN_SECRET = randomString();
process.env.AccessTokensTable = randomString();
process.env.system_bucket = randomString();
process.env.stackName = randomId('userstack');

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

  range(40).map((num) => (
    collections.push(fakeCollectionRecordFactory({
      name: num % 2 === 0 ? 'testCollection' : 'fakeCollection',
      version: `${num}`,
      cumulus_id: num,
      updated_at: new Date(1579352700000 + (num % 2) * 1000),
    }))
  ));

  await t.context.collectionPgModel.insert(
    t.context.knex,
    collections
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
    .get('/collections?limit=40')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { results } = response.body;
  t.is(results.length, 40);
  t.is(results[0].name, 'testCollection');
});

// TODO: IN CUMULUS-3699
test.todo('returns list of collections with stats when requested');

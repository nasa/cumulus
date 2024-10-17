'use strict';

const test = require('ava');
const request = require('supertest');
const cryptoRandomString = require('crypto-random-string');

const { s3 } = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const {
  destroyLocalTestDb,
  fakeProviderRecordFactory,
  generateLocalTestDb,
  localStackConnectionEnv,
  ProviderPgModel,
  translateApiProviderToPostgresProvider,
  migrationDir,
} = require('@cumulus/db');

const models = require('../../../models');
const {
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers,
} = require('../../../lib/testUtils');
const assertions = require('../../../lib/assertions');

process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();

let jwtAuthToken;
let accessTokenModel;

test.before(async (t) => {
  t.context.testDbName = `test_executions_${cryptoRandomString({ length: 10 })}`;
  await s3().createBucket({ Bucket: process.env.system_bucket });

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  process.env.AccessTokensTable = randomString();
  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  const { knex, knexAdmin } = await generateLocalTestDb(t.context.testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: t.context.testDbName,
  };

  // eslint-disable-next-line global-require
  const { app } = require('../../../app');
  t.context.app = app;
});

test.beforeEach(async (t) => {
  t.context.testProvider = fakeProviderRecordFactory();
  const providerPgModel = new ProviderPgModel();
  await providerPgModel.create(t.context.knex, t.context.testProvider);
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await accessTokenModel.deleteTable();
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName: t.context.testDbName,
  });
});

test('CUMULUS-911 GET with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(t.context.app)
    .get('/providers/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 GET with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(t.context.app)
    .get('/providers/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 GET with pathParameters and with an unauthorized user returns an unauthorized response');

test('GET returns an existing provider', async (t) => {
  const response = await request(t.context.app)
    .get(`/providers/${t.context.testProvider.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.like(await translateApiProviderToPostgresProvider(response.body), t.context.testProvider);
});

test('GET returns not found for a missing provider', async (t) => {
  const response = await request(t.context.app)
    .get('/providers/missing-provider-id')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);

  t.is(response.body.error, 'Not Found');
  t.is(response.body.message, 'Provider missing-provider-id not found.');
});

'use strict';

const test = require('ava');
const request = require('supertest');
const cryptoRandomString = require('crypto-random-string');
const { s3 } = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const { bootstrapElasticSearch } = require('@cumulus/es-client/bootstrap');
const { getEsClient } = require('@cumulus/es-client/search');
const indexer = require('@cumulus/es-client/indexer');

const {
  ProviderPgModel,
  localStackConnectionEnv,
  generateLocalTestDb,
  migrationDir,
  fakeProviderRecordFactory,
  destroyLocalTestDb,
} = require('@cumulus/db');
const models = require('../../../models');
const {
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers,
} = require('../../../lib/testUtils');
const assertions = require('../../../lib/assertions');

process.env.AccessTokensTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../../app');

const esIndex = randomString();
let esClient;

let jwtAuthToken;
let accessTokenModel;

test.before(async (t) => {
  await s3().createBucket({ Bucket: process.env.system_bucket });

  accessTokenModel = new models.AccessToken();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  const esAlias = randomString();
  process.env.ES_INDEX = esAlias;

  await Promise.all([
    accessTokenModel.createTable(),
    bootstrapElasticSearch({
      host: 'fakehost',
      index: esIndex,
      alias: esAlias,
    }),
  ]);

  t.context.testDbName = `test_providers_${cryptoRandomString({ length: 10 })}`;

  const { knex, knexAdmin } = await generateLocalTestDb(t.context.testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: t.context.testDbName,
  };

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  esClient = await getEsClient('fakehost');
});

test.after.always((t) => Promise.all([
  recursivelyDeleteS3Bucket(process.env.system_bucket),
  accessTokenModel.deleteTable(),
  esClient.client.indices.delete({ index: esIndex }),
  destroyLocalTestDb({
    ...t.context,
  }),
]));

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/providers')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 GET without pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/providers')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 GET without pathParameters and with an unauthorized user returns an unauthorized response');

test('default returns list of providers', async (t) => {
  const testProvider = fakeProviderRecordFactory();
  const providerPgModel = new ProviderPgModel();
  const [provider] = await providerPgModel.create(t.context.knex, testProvider);
  const pgProvider = await providerPgModel.get(t.context.knex, { cumulus_id: provider.cumulus_id });
  await indexer.indexProvider(esClient, pgProvider, esIndex);

  const response = await request(app)
    .get('/providers')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { results } = response.body;
  t.truthy(results.find((r) => r.id === testProvider.id));
});

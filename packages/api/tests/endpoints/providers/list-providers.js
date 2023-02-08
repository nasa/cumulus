'use strict';

const test = require('ava');
const request = require('supertest');
const { s3 } = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const { bootstrapElasticSearch } = require('@cumulus/es-client/bootstrap');
const { Search } = require('@cumulus/es-client/search');
const indexer = require('@cumulus/es-client/indexer');
const {
  localStackConnectionEnv,
  generateLocalTestDb,
  destroyLocalTestDb,
  ProviderPgModel,
  migrationDir,
} = require('@cumulus/db');

const models = require('../../../models');
const {
  createFakeJwtAuthToken,
  fakeProviderFactory,
  setAuthorizedOAuthUsers,
} = require('../../../lib/testUtils');
const assertions = require('../../../lib/assertions');

const testDbName = randomString(12);
process.env.AccessTokensTable = randomString();
process.env.ProvidersTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();
process.env = {
  ...process.env,
  ...localStackConnectionEnv,
  PG_DATABASE: testDbName,
};

// import the express app after setting the env variables
const { app } = require('../../../app');

let providerModel;
const esIndex = randomString();
let esClient;

let jwtAuthToken;
let accessTokenModel;

test.before(async (t) => {
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;
  t.context.providerPgModel = new ProviderPgModel();

  await s3().createBucket({ Bucket: process.env.system_bucket });

  accessTokenModel = new models.AccessToken();
  providerModel = new models.Provider();

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
    providerModel.createTable(),
  ]);

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  esClient = await Search.es('fakehost');
});

test.after.always((t) => Promise.all([
  recursivelyDeleteS3Bucket(process.env.system_bucket),
  accessTokenModel.deleteTable(),
  esClient.indices.delete({ index: esIndex }),
  providerModel.deleteTable(),
  destroyLocalTestDb({
    knex: t.context.testKnex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
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

test.skip('default returns list of providerModel', async (t) => {
  const testProvider = fakeProviderFactory();
  console.log('testProvider', testProvider);
  const record = await providerModel.create(testProvider);
  await indexer.indexProvider(esClient, record, esIndex);

  const response = await request(app)
    .get('/providers')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { results } = response.body;
  console.log('RESULTS', results);
  console.log('testProvider.id', testProvider.id);
  t.truthy(results.find((r) => r.id === testProvider.id));
});

test('list returns a paginated response of provider objects', async (t) => {
  const newProviderId = randomString();
  const newProvider = fakeProviderFactory({
    id: newProviderId,
  });
  const providers = [];
  // create first provider
  await request(app)
    .post('/providers')
    .send(newProvider)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  for (let i = 0; i < 40; i += 1) {
    providers.push(fakeProviderFactory());
  }

  for (let i = 0; i < 40; i += 1) {
    // create provider
    await request(app)
      .post('/providers')
      .send(providers[i])
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .expect(200);
  }

  const response = await request(app)
    .get('/providers')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { results } = response.body;
  t.truthy(results.find((r) => r.id === newProviderId));
});
'use strict';

const test = require('ava');
const request = require('supertest');
const { randomString } = require('@cumulus/common/test-utils');
const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');

const bootstrap = require('../../../lambdas/bootstrap');
const models = require('../../../models');
const {
  createFakeJwtAuthToken,
  fakeProviderFactory
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const indexer = require('../../../es/indexer');
const assertions = require('../../../lib/assertions');
const { fakeRuleFactoryV2 } = require('../../../lib/testUtils');

process.env.UsersTable = randomString();
process.env.ProvidersTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../../app');

let esIndex;
let esClient;
let providerModel;

let jwtAuthToken;
let accessTokenModel;
let ruleModel;
let userModel;

test.before(async () => {
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);

  providerModel = new models.Provider();
  await providerModel.createTable();

  userModel = new models.User();
  await userModel.createTable();

  process.env.AccessTokensTable = randomString();
  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });

  esClient = await Search.es('fakehost');
  esIndex = 'localrun-es';

  process.env.RulesTable = randomString();
  ruleModel = new models.Rule();
  await ruleModel.createTable();

  process.env.system_bucket = randomString();
  await s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  process.env.stackName = randomString();
});

test.beforeEach(async (t) => {
  t.context.testProvider = fakeProviderFactory();
  const newProvider = await providerModel.create(t.context.testProvider);
  indexer.indexProvider(esClient, newProvider, esIndex);
});

test.after.always(async () => {
  await providerModel.deleteTable();
  await userModel.deleteTable();
  await accessTokenModel.deleteTable();
  await esClient.indices.delete({ index: esIndex });
  await ruleModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test('Attempting to delete a provider without an Authorization header returns an Authorization Missing response', async (t) => {
  const { testProvider } = t.context;

  const response = await request(app)
    .delete(`/providers/${testProvider.id}`)
    .set('Accept', 'application/json')
    .expect(401);

  t.is(response.status, 401);
  t.true(await providerModel.exists(testProvider.id));
});

test('Attempting to delete a provider with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .delete('/providers/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('Attempting to delete a provider with an unauthorized user returns an unauthorized response');

test('Deleting a provider removes the provider', async (t) => {
  const { testProvider } = t.context;

  await request(app)
    .delete(`/providers/${testProvider.id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.false(await providerModel.exists(testProvider.id));
});

test('Attempting to delete a provider with an associated rule returns a 409 response', async (t) => {
  const { testProvider } = t.context;

  const rule = fakeRuleFactoryV2({
    provider: testProvider.id,
    rule: {
      type: 'onetime'
    }
  });

  // The workflow message template must exist in S3 before the rule can be created
  await s3().putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/workflows/${rule.workflow}.json`,
    Body: JSON.stringify({})
  }).promise();

  await ruleModel.create(rule);

  const response = await request(app)
    .delete(`/providers/${testProvider.id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(409);

  t.is(response.status, 409);
  t.is(response.body.message, `Cannot delete provider with associated rules: ${rule.name}`);
});

test('Attempting to delete a provider with an associated rule does not delete the provider', async (t) => {
  const { testProvider } = t.context;

  const rule = fakeRuleFactoryV2({
    provider: testProvider.id,
    rule: {
      type: 'onetime'
    }
  });

  // The workflow message template must exist in S3 before the rule can be created
  await s3().putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/workflows/${rule.workflow}.json`,
    Body: JSON.stringify({})
  }).promise();

  await ruleModel.create(rule);

  await request(app)
    .delete(`/providers/${testProvider.id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(409);

  t.true(await providerModel.exists(testProvider.id));
});

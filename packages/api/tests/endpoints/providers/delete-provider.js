'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');

const bootstrap = require('../../../lambdas/bootstrap');
const models = require('../../../models');
const providerEndpoint = require('../../../endpoints/providers');
const {
  fakeUserFactory,
  fakeProviderFactory,
  testEndpoint
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const assertions = require('../../../lib/assertions');
const { fakeRuleFactoryV2 } = require('../../../lib/testUtils');

process.env.UsersTable = randomString();
process.env.ProvidersTable = randomString();
process.env.stackName = randomString();
process.env.internal = randomString();
let providerModel;
const esIndex = randomString();
let esClient;

let authHeaders;
let ruleModel;
let userModel;

test.before(async () => {
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);

  providerModel = new models.Provider();
  await providerModel.createTable();

  userModel = new models.User();
  await userModel.createTable();

  const authToken = (await userModel.create(fakeUserFactory())).password;
  authHeaders = {
    Authorization: `Bearer ${authToken}`
  };

  esClient = await Search.es('fakehost');

  process.env.RulesTable = randomString();
  ruleModel = new models.Rule();
  await ruleModel.createTable();

  process.env.bucket = randomString();
  await s3().createBucket({ Bucket: process.env.bucket }).promise();

  process.env.stackName = randomString();
});

test.beforeEach(async (t) => {
  t.context.testProvider = fakeProviderFactory();
  await providerModel.create(t.context.testProvider);
});

test.after.always(async () => {
  await providerModel.deleteTable();
  await userModel.deleteTable();
  await esClient.indices.delete({ index: esIndex });
  await ruleModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.bucket);
});

test('Attempting to delete a provider without an Authorization header returns an Authorization Missing response', (t) => {
  const { testProvider } = t.context;

  const request = {
    httpMethod: 'DELETE',
    pathParameters: { id: testProvider.id },
    headers: {}
  };

  return testEndpoint(providerEndpoint, request, async (response) => {
    t.is(response.statusCode, 401);
    t.true(await providerModel.exists(testProvider.id));
  });
});

test('Attempting to delete a provider with an unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'DELETE',
    pathParameters: {
      id: 'asdf'
    },
    headers: {
      Authorization: 'Bearer invalid-token'
    }
  };

  return testEndpoint(providerEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('Deleting a provider removes the provider', (t) => {
  const { testProvider } = t.context;

  const deleteRequest = {
    httpMethod: 'DELETE',
    pathParameters: { id: testProvider.id },
    headers: authHeaders
  };

  return testEndpoint(providerEndpoint, deleteRequest, async () => {
    t.false(await providerModel.exists(testProvider.id));
  });
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
    Bucket: process.env.bucket,
    Key: `${process.env.stackName}/workflows/${rule.workflow}.json`,
    Body: JSON.stringify({})
  }).promise();

  await ruleModel.create(rule);

  const deleteRequest = {
    httpMethod: 'DELETE',
    pathParameters: { id: testProvider.id },
    headers: authHeaders
  };

  return testEndpoint(providerEndpoint, deleteRequest, (response) => {
    t.is(response.statusCode, 409);

    const body = JSON.parse(response.body);
    t.is(body.message, `Cannot delete provider with associated rules: ${rule.name}`);
  });
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
    Bucket: process.env.bucket,
    Key: `${process.env.stackName}/workflows/${rule.workflow}.json`,
    Body: JSON.stringify({})
  }).promise();

  await ruleModel.create(rule);

  const deleteRequest = {
    httpMethod: 'DELETE',
    pathParameters: { id: testProvider.id },
    headers: authHeaders
  };

  return testEndpoint(providerEndpoint, deleteRequest, async () => {
    t.true(await providerModel.exists(testProvider.id));
  });
});

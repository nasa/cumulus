'use strict';

const test = require('ava');
const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');

const bootstrap = require('../../../lambdas/bootstrap');
const models = require('../../../models');
const providerEndpoint = require('../../../endpoints/providers');
const {
  fakeUserFactory,
  fakeProviderFactory,
  fakeRuleFactoryV2,
  testEndpoint
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const assertions = require('../../../lib/assertions');
const MessageTemplateStore = require('../../../lib/MessageTemplateStore');

let providerModel;
let ruleModel;
const esIndex = randomString();
let esClient;

let authHeaders;
let userModel;

async function createAndSaveRule(providerId) {
  const rule = fakeRuleFactoryV2({
    provider: providerId,
    rule: {
      type: 'onetime'
    }
  });

  const messageTemplateStore = new MessageTemplateStore({
    bucket: process.env.bucket,
    s3: s3(),
    stackName: process.env.stackName
  });

  await messageTemplateStore.put(rule.workflow, 'my-message-template');

  await ruleModel.create(rule);
}

test.before(async () => {
  process.env.bucket = randomString();
  process.env.internal = randomString();
  process.env.stackName = randomString();

  process.env.ProvidersTable = randomString();
  providerModel = new models.Provider();

  process.env.RulesTable = randomString();
  ruleModel = new models.Rule();

  process.env.UsersTable = randomString();
  userModel = new models.User();

  await Promise.all([
    s3().createBucket({ Bucket: process.env.bucket }).promise(),
    bootstrap.bootstrapElasticSearch('fakehost', esIndex),
    providerModel.createTable(),
    ruleModel.createTable(),
    userModel.createTable()
  ]);

  const authToken = (await userModel.create(fakeUserFactory())).password;
  authHeaders = {
    Authorization: `Bearer ${authToken}`
  };

  esClient = await Search.es('fakehost');
});

test.beforeEach(async (t) => {
  t.context.testProvider = fakeProviderFactory();
  await providerModel.create(t.context.testProvider);
});

test.after.always(async () => {
  await Promise.all([
    esClient.indices.delete({ index: esIndex }),
    recursivelyDeleteS3Bucket(process.env.bucket),
    providerModel.deleteTable(),
    ruleModel.deleteTable(),
    userModel.deleteTable()
  ]);
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

test('Attempting to delete a provider with an associated rule returns a 400 response', async (t) => {
  const { testProvider } = t.context;

  await createAndSaveRule(testProvider.id);

  const deleteRequest = {
    httpMethod: 'DELETE',
    pathParameters: { id: testProvider.id },
    headers: authHeaders
  };

  return testEndpoint(providerEndpoint, deleteRequest, (response) => {
    t.is(response.statusCode, 400);

    const body = JSON.parse(response.body);
    t.is(body.message, 'Cannot delete a provider that has associated rules');
  });
});

test('Attempting to delete a provider with an associated rule does not delete the provider', async (t) => {
  const { testProvider } = t.context;

  await createAndSaveRule(testProvider.id);

  const deleteRequest = {
    httpMethod: 'DELETE',
    pathParameters: { id: testProvider.id },
    headers: authHeaders
  };

  return testEndpoint(providerEndpoint, deleteRequest, async () => {
    t.true(await providerModel.exists(testProvider.id));
  });
});

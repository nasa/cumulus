'use strict';

const test = require('ava');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const models = require('../../../models');
const bootstrap = require('../../../lambdas/bootstrap');
const collectionsEndpoint = require('../../../endpoints/collections');
const {
  createAccessToken,
  fakeCollectionFactory,
  testEndpoint
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const assertions = require('../../../lib/assertions');

process.env.AccessTokensTable = randomString();
process.env.CollectionsTable = randomString();
process.env.UsersTable = randomString();
process.env.stackName = randomString();
process.env.internal = randomString();

const esIndex = randomString();
let esClient;

let authHeaders;
let accessTokenModel;
let collectionModel;
let userModel;

test.before(async () => {
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);
  await aws.s3().createBucket({ Bucket: process.env.internal }).promise();

  collectionModel = new models.Collection({ tableName: process.env.CollectionsTable });
  await collectionModel.createTable();

  // create fake Users table
  userModel = new models.User();
  await userModel.createTable();

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  process.env.TOKEN_SECRET = randomString();

  const accessToken = await createAccessToken({ accessTokenModel, userModel });
  authHeaders = {
    Authorization: `Bearer ${accessToken}`
  };

  esClient = await Search.es('fakehost');
});

test.beforeEach(async (t) => {
  t.context.testCollection = fakeCollectionFactory();
  await collectionModel.create(t.context.testCollection);
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await collectionModel.deleteTable();
  await userModel.deleteTable();
  await aws.recursivelyDeleteS3Bucket(process.env.internal);
  await esClient.indices.delete({ index: esIndex });
});

test('CUMULUS-911 PUT with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'PUT',
    pathParameters: {
      collectionName: 'asdf',
      version: 'asdf'
    },
    headers: {}
  };

  return testEndpoint(collectionsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-912 PUT with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'PUT',
    pathParameters: {
      collectionName: 'asdf',
      version: 'asdf'
    },
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(collectionsEndpoint, request, (response) => {
    assertions.isInvalidAccessTokenResponse(t, response);
  });
});

test.todo('CUMULUS-912 PUT with pathParameters and with an unauthorized user returns an unauthorized response');

test('PUT updates an existing collection', (t) => {
  const newPath = '/new_path';
  const updateEvent = {
    body: JSON.stringify({
      name: t.context.testCollection.name,
      version: t.context.testCollection.version,
      provider_path: newPath
    }),
    pathParameters: {
      collectionName: t.context.testCollection.name,
      version: t.context.testCollection.version
    },
    httpMethod: 'PUT',
    headers: authHeaders
  };

  return testEndpoint(collectionsEndpoint, updateEvent, (response) => {
    const { provider_path } = JSON.parse(response.body); // eslint-disable-line camelcase
    t.is(provider_path, newPath);
  });
});

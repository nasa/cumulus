'use strict';

const test = require('ava');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const models = require('../../../models');
const bootstrap = require('../../../lambdas/bootstrap');
const collectionsEndpoint = require('../../../endpoints/collections');
const {
  createFakeJwtAuthToken,
  fakeCollectionFactory,
  testEndpoint
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const assertions = require('../../../lib/assertions');
const { RecordDoesNotExist } = require('../../../lib/errors');

process.env.AccessTokensTable = randomString();
process.env.CollectionsTable = randomString();
process.env.UsersTable = randomString();
process.env.stackName = randomString();
process.env.internal = randomString();
process.env.TOKEN_SECRET = randomString();

const esIndex = randomString();
let esClient;

let authHeaders;
let accessTokenModel;
let collectionModel;
let userModel;

const collectionDoesNotExist = async (t, collection) => {
  const error = await t.throws(collectionModel.get({
    name: collection.name,
    version: collection.version
  }));
  t.true(error instanceof RecordDoesNotExist);
};

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

  const jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });
  authHeaders = {
    Authorization: `Bearer ${jwtAuthToken}`
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

test('CUMULUS-911 POST without an Authorization header returns an Authorization Missing response', (t) => {
  const newCollection = fakeCollectionFactory();
  const request = {
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify(newCollection)
  };

  return testEndpoint(collectionsEndpoint, request, async (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
    await collectionDoesNotExist(t, newCollection);
  });
});

test('CUMULUS-912 POST with an invalid access token returns an unauthorized response', async (t) => {
  const newCollection = fakeCollectionFactory();
  const request = {
    httpMethod: 'POST',
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    },
    body: JSON.stringify(newCollection)
  };

  return testEndpoint(collectionsEndpoint, request, async (response) => {
    assertions.isInvalidAccessTokenResponse(t, response);
    await collectionDoesNotExist(t, newCollection);
  });
});

test.todo('CUMULUS-912 POST with an unauthorized user returns an unauthorized response');

test('POST with invalid authorization scheme returns an invalid token response', (t) => {
  const newCollection = fakeCollectionFactory();
  const request = {
    httpMethod: 'POST',
    headers: {
      Authorization: 'InvalidBearerScheme ThisIsAnInvalidAuthorizationToken'
    },
    body: JSON.stringify(newCollection)
  };

  return testEndpoint(collectionsEndpoint, request, async (response) => {
    assertions.isInvalidAuthorizationResponse(t, response);
    await collectionDoesNotExist(t, newCollection);
  });
});

test('POST creates a new collection', (t) => {
  const newCollection = fakeCollectionFactory();
  const postEvent = {
    httpMethod: 'POST',
    headers: authHeaders,
    body: JSON.stringify(newCollection)
  };
  return testEndpoint(collectionsEndpoint, postEvent, (response) => {
    const { message, record } = JSON.parse(response.body);
    t.is(message, 'Record saved');
    t.is(record.name, newCollection.name);
  });
});

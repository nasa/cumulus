'use strict';

const test = require('ava');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const models = require('../../../models');
const bootstrap = require('../../../lambdas/bootstrap');
const collectionsEndpoint = require('../../../endpoints/collections');
const {
  fakeCollectionFactory,
  fakeUserFactory,
  testEndpoint
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const assertions = require('../../../lib/assertions');

process.env.CollectionsTable = randomString();
process.env.UsersTable = randomString();
process.env.stackName = randomString();
process.env.internal = randomString();

const esIndex = randomString();
let esClient;

let authHeaders;
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

  const authToken = (await userModel.create(fakeUserFactory())).password;
  authHeaders = {
    Authorization: `Bearer ${authToken}`
  };

  esClient = await Search.es('fakehost');
});

test.beforeEach(async (t) => {
  t.context.testCollection = fakeCollectionFactory();
  await collectionModel.create(t.context.testCollection);
});

test.after.always(async () => {
  await collectionModel.deleteTable();
  await userModel.deleteTable();
  await aws.recursivelyDeleteS3Bucket(process.env.internal);
  await esClient.indices.delete({ index: esIndex });
});

test('Attempting to delete a collection without an Authorization header returns an Authorization Missing response', (t) => {
  const { testCollection } = t.context;

  const request = {
    httpMethod: 'DELETE',
    pathParameters: {
      collectionName: testCollection.name,
      version: testCollection.version
    },
    headers: {}
  };

  return testEndpoint(collectionsEndpoint, request, async (response) => {
    t.is(response.statusCode, 401);

    t.true(
      await collectionModel.exists(
        testCollection.name,
        testCollection.version
      )
    );
  });
});

test('Attempting to delete a collection with an unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'DELETE',
    pathParameters: {
      collectionName: 'asdf',
      version: 'asdf'
    },
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(collectionsEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('Deleting a collection removes it', async (t) => {
  const collection = fakeCollectionFactory();
  await collectionModel.create(collection);

  const deleteEvent = {
    httpMethod: 'DELETE',
    pathParameters: {
      collectionName: collection.name,
      version: collection.version
    },
    headers: authHeaders
  };

  return testEndpoint(collectionsEndpoint, deleteEvent, () => {
    const getCollectionRequest = {
      httpMethod: 'GET',
      pathParameters: {
        collectionName: collection.name,
        version: collection.version
      },
      headers: authHeaders
    };

    return testEndpoint(collectionsEndpoint, getCollectionRequest, (response) => {
      t.is(response.statusCode, 404);
    });
  });
});

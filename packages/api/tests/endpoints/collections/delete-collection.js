'use strict';

const test = require('ava');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');

const models = require('../../../models');
const bootstrap = require('../../../lambdas/bootstrap');
const collectionsEndpoint = require('../../../endpoints/collections');
const {
  fakeCollectionFactory,
  testEndpoint,
  createJwtAuthToken
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const assertions = require('../../../lib/assertions');
const { fakeRuleFactoryV2 } = require('../../../lib/testUtils');

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
let ruleModel;
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

  const accessToken = await createJwtAuthToken({ accessTokenModel, userModel });
  authHeaders = {
    Authorization: `Bearer ${accessToken}`
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
  t.context.testCollection = fakeCollectionFactory();
  await collectionModel.create(t.context.testCollection);
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await collectionModel.deleteTable();
  await userModel.deleteTable();
  await aws.recursivelyDeleteS3Bucket(process.env.internal);
  await esClient.indices.delete({ index: esIndex });
  await ruleModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.bucket);
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

test('Attempting to delete a collection with an invalid access token returns an unauthorized response', async (t) => {
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
    assertions.isInvalidAccessTokenResponse(t, response);
  });
});

test.todo('Attempting to delete a collection with an unauthorized user returns an unauthorized response');

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

test('Attempting to delete a collection with an associated rule returns a 409 response', async (t) => {
  const collection = fakeCollectionFactory();
  await collectionModel.create(collection);

  const rule = fakeRuleFactoryV2({
    collection: {
      name: collection.name,
      version: collection.version
    },
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
    pathParameters: {
      collectionName: collection.name,
      version: collection.version
    },
    headers: authHeaders
  };

  return testEndpoint(collectionsEndpoint, deleteRequest, (response) => {
    t.is(response.statusCode, 409);

    const body = JSON.parse(response.body);
    t.is(body.message, `Cannot delete collection with associated rules: ${rule.name}`);
  });
});

test('Attempting to delete a collection with an associated rule does not delete the provider', async (t) => {
  const collection = fakeCollectionFactory();
  await collectionModel.create(collection);

  const rule = fakeRuleFactoryV2({
    collection: {
      name: collection.name,
      version: collection.version
    },
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
    pathParameters: {
      collectionName: collection.name,
      version: collection.version
    },
    headers: authHeaders
  };

  return testEndpoint(collectionsEndpoint, deleteRequest, async () => {
    t.true(await collectionModel.exists(collection.name, collection.version));
  });
});

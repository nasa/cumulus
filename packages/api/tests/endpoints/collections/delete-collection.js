'use strict';

const test = require('ava');
const request = require('supertest');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');

const models = require('../../../models');
const bootstrap = require('../../../lambdas/bootstrap');
const {
  fakeCollectionFactory,
  createFakeJwtAuthToken
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

// import the express app after setting the env variables
const { app } = require('../../../app');

const esIndex = randomString();
let esClient;

let jwtAuthToken;
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

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });

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

test('Attempting to delete a collection without an Authorization header returns an Authorization Missing response', async (t) => {
  const { testCollection } = t.context;
  const response = await request(app)
    .delete(`/collections/${testCollection.name}/${testCollection.version}`)
    .set('Accept', 'application/json')
    .expect(401);

  t.is(response.status, 401);
  t.true(
    await collectionModel.exists(
      testCollection.name,
      testCollection.version
    )
  );
});

test('Attempting to delete a collection with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .delete('/collections/asdf/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('Attempting to delete a collection with an unauthorized user returns an unauthorized response');

test('Deleting a collection removes it', async (t) => {
  const collection = fakeCollectionFactory();
  await collectionModel.create(collection);

  await request(app)
    .delete(`/collections/${collection.name}/${collection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const response = await request(app)
    .get(`/collections/${collection.name}/${collection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);

  t.is(response.status, 404);
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

  const response = await request(app)
    .delete(`/collections/${collection.name}/${collection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(409);

  t.is(response.status, 409);
  t.is(response.body.message, `Cannot delete collection with associated rules: ${rule.name}`);
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

  await request(app)
    .delete(`/collections/${collection.name}/${collection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(409);

  t.true(await collectionModel.exists(collection.name, collection.version));
});

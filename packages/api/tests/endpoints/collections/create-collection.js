'use strict';

const test = require('ava');
const request = require('supertest');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const models = require('../../../models');
const bootstrap = require('../../../lambdas/bootstrap');
const {
  createFakeJwtAuthToken,
  fakeCollectionFactory
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const assertions = require('../../../lib/assertions');

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

test('CUMULUS-911 POST without an Authorization header returns an Authorization Missing response', async (t) => {
  const newCollection = fakeCollectionFactory();
  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .expect(401);
  assertions.isAuthorizationMissingResponse(t, res);
});

test('CUMULUS-912 POST with an invalid access token returns an unauthorized response', async (t) => {
  const newCollection = fakeCollectionFactory();
  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);
  assertions.isInvalidAccessTokenResponse(t, res);
});

test.todo('CUMULUS-912 POST with an unauthorized user returns an unauthorized response');

test('POST with invalid authorization scheme returns an invalid token response', async (t) => {
  const newCollection = fakeCollectionFactory();
  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', 'InvalidBearerScheme ThisIsAnInvalidAuthorizationToken')
    .expect(401);
  assertions.isInvalidAuthorizationResponse(t, res);
});

test('POST creates a new collection', async (t) => {
  const newCollection = fakeCollectionFactory();
  const res = await request(app)
    .post('/collections')
    .send(newCollection)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { message, record } = res.body;
  t.is(message, 'Record saved');
  t.is(record.name, newCollection.name);
});

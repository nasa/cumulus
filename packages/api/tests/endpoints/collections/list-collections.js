'use strict';

const test = require('ava');
const request = require('supertest');
const sinon = require('sinon');
const awsServices = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const { bootstrapElasticSearch } = require('@cumulus/es-client/bootstrap');
const EsCollection = require('@cumulus/es-client/collections');
const { getEsClient } = require('@cumulus/es-client/search');

const models = require('../../../models');
const {
  createFakeJwtAuthToken,
  fakeCollectionFactory,
  setAuthorizedOAuthUsers,
} = require('../../../lib/testUtils');
const assertions = require('../../../lib/assertions');

process.env.AccessTokensTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../../app');

const esIndex = randomString();
let esClient;

let jwtAuthToken;
let accessTokenModel;

test.before(async () => {
  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket });

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );

  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.collectionPgModel = new CollectionPgModel();
  const collections = [];

  range(40).map((num) => (
    collections.push(fakeCollectionRecordFactory({
      name: num % 2 === 0 ? 'testCollection' : 'fakeCollection',
      version: `${num}`,
      cumulus_id: num,
      updated_at: new Date(1579352700000 + (num % 2) * 1000),
    }))
  ));

  await t.context.collectionPgModel.insert(
    t.context.knex,
    collections
  );
});

test.beforeEach((t) => {
  t.context.testCollection = fakeCollectionFactory();
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/collections')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 GET without pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/collections')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 GET without pathParameters and with an unauthorized user returns an unauthorized response');

test.serial('default returns list of collections from query', async (t) => {
  const stub = sinon.stub(EsCollection.prototype, 'query').returns({ results: [t.context.testCollection] });
  const spy = sinon.stub(EsCollection.prototype, 'addStatsToCollectionResults');

  const response = await request(app)
    .get('/collections')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { results } = response.body;
  t.is(results.length, 1);
  t.is(results[0].name, t.context.testCollection.name);
  t.true(spy.notCalled);
  stub.restore();
  spy.restore();
});

test.serial('returns list of collections with stats when requested', async (t) => {
  const stub = sinon.stub(EsCollection.prototype, 'getStats').returns([t.context.testCollection]);

  const response = await request(app)
    .get('/collections?includeStats=true')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { results } = response.body;
  t.is(results.length, 1);
  t.is(results[0].name, t.context.testCollection.name);
  stub.restore();
});

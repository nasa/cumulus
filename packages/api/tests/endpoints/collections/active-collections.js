'use strict';

const test = require('ava');
const request = require('supertest');
const sinon = require('sinon');
const rewire = require('rewire');
const awsServices = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');
const { bootstrapElasticSearch } = require('@cumulus/es-client/bootstrap');
const indexer = rewire('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');

const models = require('../../../models');
const {
  createFakeJwtAuthToken,
  fakeCollectionFactory,
  fakeGranuleFactoryV2,
  setAuthorizedOAuthUsers,
} = require('../../../lib/testUtils');
const assertions = require('../../../lib/assertions');

process.env.AccessTokensTable = randomId('accessTokensTable');
process.env.GranulesTable = randomId('granulesTable');
process.env.stackName = randomId('stackName');
process.env.system_bucket = randomId('bucket');
process.env.TOKEN_SECRET = randomId('tokenSecret');

// import the express app after setting the env variables
const { app } = require('../../../app');

const esIndex = randomId('esindex');
let esClient;

let jwtAuthToken;
let accessTokenModel;

test.before(async () => {
  const esAlias = randomId('esAlias');
  process.env.ES_INDEX = esAlias;
  await bootstrapElasticSearch({
    host: 'fakehost',
    index: esIndex,
    alias: esAlias,
  });
  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket });

  const username = randomId('username');
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
  esClient = await Search.es('fakehost');

  await Promise.all([
    indexer.indexCollection(esClient, fakeCollectionFactory({
      name: 'coll1',
      version: '1',
    }), esAlias),
    indexer.indexCollection(esClient, fakeCollectionFactory({
      name: 'coll2',
      version: '1',
    }), esAlias),
    indexer.indexGranule(esClient, fakeGranuleFactoryV2({ collectionId: 'coll1___1' }), esAlias),
    indexer.indexGranule(esClient, fakeGranuleFactoryV2({ collectionId: 'coll1___1' }), esAlias),
  ]);

  // Indexing using Date.now() to generate the timestamp
  const stub = sinon.stub(Date, 'now').returns((new Date(2020, 0, 29)).getTime());

  try {
    await Promise.all([
      indexer.indexCollection(esClient, fakeCollectionFactory({
        name: 'coll3',
        version: '1',
        updatedAt: new Date(2020, 0, 29),
      }), esAlias),
      indexer.indexGranule(esClient, fakeGranuleFactoryV2({
        updatedAt: new Date(2020, 1, 29),
        collectionId: 'coll3___1',
      }), esAlias),
    ]);
  } finally {
    stub.restore();
  }
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await esClient.indices.delete({ index: esIndex });
});

test('GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/collections/active')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('GET without pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/collections/active')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.serial('default returns collections with granules', async (t) => {
  const response = await request(app)
    .get('/collections/active')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { results } = response.body;
  t.is(results.length, 2);
  t.deepEqual(results.map((r) => r.name), ['coll1', 'coll3']);
});

test.serial('timestamp__from filters collections by granule date', async (t) => {
  const fromDate = new Date(2020, 2, 1);

  const response = await request(app)
    .get(`/collections/active?timestamp__from=${fromDate.getTime()}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { results } = response.body;
  t.is(results.length, 1);
  t.is(results[0].name, 'coll1');
});

test.serial('timestamps filters collections by granule date', async (t) => {
  const fromDate = new Date(2020, 0, 1);
  const toDate = new Date(2020, 1, 1);

  const response = await request(app)
    .get(`/collections/active?timestamp__from=${fromDate.getTime()}&timestamp__to=${toDate.getTime()}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { results } = response.body;
  t.is(results.length, 1);
  t.is(results[0].name, 'coll3');
});

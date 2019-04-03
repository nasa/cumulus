'use strict';

const request = require('supertest');
const test = require('ava');

const { randomString } = require('@cumulus/common/test-utils');

const models = require('../../../models');
const assertions = require('../../../lib/assertions');
const {
  createFakeJwtAuthToken
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const { bootstrapElasticSearch } = require('../../../lambdas/bootstrap');
const es = require('../../../bin/es');
const mappings = require('../../../models/mappings.json');

const esIndex = 'cumulus-1';

process.env.AccessTokensTable = randomString();
process.env.UsersTable = randomString();
process.env.TOKEN_SECRET = randomString();
process.env.ES_INDEX = esIndex;

// import the express app after setting the env variables
const { app } = require('../../../app');

let jwtAuthToken;
let accessTokenModel;
let userModel;

const indexAlias = 'cumulus-1-alias';
let esClient;

/**
 * Index fake data
 *
 * @returns {undefined} - none
 */
async function indexData() {
  const rules = [
    { name: 'Rule1' },
    { name: 'Rule2' },
    { name: 'Rule3' }
  ];

  await Promise.all(rules.map(async (rule) => {
    await esClient.index({
      index: esIndex,
      type: 'rule',
      id: rule.name,
      body: rule
    });
  }));

  await esClient.indices.refresh();
}

/**
 * Create and alias index by going through ES bootstrap
 *
 * @param {string} indexName - index name
 * @param {string} aliasName  - alias name
 * @returns {undefined} - none
 */
async function createIndex(indexName, aliasName) {
  await bootstrapElasticSearch('fakehost', indexName, aliasName);
  esClient = await Search.es();
}

test.before(async () => {
  userModel = new models.User();
  await userModel.createTable();

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });

  // create the elasticsearch index and add mapping
  await createIndex(esIndex, indexAlias);

  await indexData();
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await userModel.deleteTable();
  await esClient.indices.delete({ index: esIndex });
});

test('PUT snapshot without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .put('/elasticsearch/create-snapshot')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('PUT snapshot with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .put('/elasticsearch/create-snapshot')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.serial('PUT snapshot', async (t) => {
  const response = await request(app)
    .put('/elasticsearch/create-snapshot')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);
});

test.serial('Reindex - multiple aliases found', async (t) => {
  const indexName = 'cumulus-dup';

  await esClient.indices.create({
    index: indexName,
    body: { mappings }
  });

  await esClient.indices.putAlias({
    index: indexName,
    name: indexAlias
  });

  const response = await request(app)
    .put('/elasticsearch/reindex')
    .send({ aliasName: indexAlias })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  console.log(response.body);

  t.is(response.body.message, 'Multiple indices found for alias cumulus-1-alias. Specify source index as one of [cumulus-1, cumulus-dup]');

  await esClient.indices.delete({ index: indexName });
});

test.serial('Reindex - specify a source index that does not exist', async (t) => {
  const response = await request(app)
    .put('/elasticsearch/reindex')
    .send({ aliasName: indexAlias, sourceIndex: 'source-index' })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  t.is(response.body.message, 'Source index source-index does not exist.');
});

test.serial('Reindex - specify a source index that is not aliased', async (t) => {
  const indexName = 'source-index';

  await esClient.indices.create({
    index: indexName,
    body: { mappings }
  });

  const response = await request(app)
    .put('/elasticsearch/reindex')
    .send({ aliasName: indexAlias, sourceIndex: indexName })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  t.is(response.body.message, 'Source index source-index is not aliased with alias cumulus-1-alias.');

  await esClient.indices.delete({ index: indexName });
});




'use strict';

const request = require('supertest');
const test = require('ava');
const get = require('lodash.get');

const { randomString } = require('@cumulus/common/test-utils');

const models = require('../../../models');
const assertions = require('../../../lib/assertions');
const {
  createFakeJwtAuthToken
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const { bootstrapElasticSearch } = require('../../../lambdas/bootstrap');
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

test.serial('Reindex - multiple aliases found', async (t) => {
  // Prefixes for error message predictability
  const indexName = `z-${randomString()}`;
  const otherIndexName = `a-${randomString()}`;

  const aliasName = randomString();

  await esClient.indices.create({
    index: indexName,
    body: { mappings }
  });

  await esClient.indices.putAlias({
    index: indexName,
    name: aliasName
  });

  await esClient.indices.create({
    index: otherIndexName,
    body: { mappings }
  });

  await esClient.indices.putAlias({
    index: otherIndexName,
    name: aliasName
  });

  const response = await request(app)
    .put('/elasticsearch/reindex')
    .send({ aliasName })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  t.is(response.body.message, `Multiple indices found for alias ${aliasName}. Specify source index as one of [${otherIndexName}, ${indexName}].`);

  await esClient.indices.delete({ index: indexName });
  await esClient.indices.delete({ index: otherIndexName });
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

test.serial('Reindex success', async (t) => {
  const destIndex = randomString();

  const response = await request(app)
    .put('/elasticsearch/reindex')
    .send({
      aliasName: indexAlias,
      destIndex,
      sourceIndex: esIndex
    })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.body.message, `Reindexing to ${destIndex} from ${esIndex}. Check the reindex-status endpoint for status.`);

  // Refresh to make sure the records are in the destination index
  await esClient.indices.refresh();

  // Validate that the destination index was created
  t.is(true, await esClient.indices.exists({ index: destIndex }));

  // Validate destination index mappings are correct
  const fieldMappings = await esClient.indices.getMapping();

  const sourceMapping = get(fieldMappings, esIndex);
  const destMapping = get(fieldMappings, destIndex);

  t.deepEqual(sourceMapping.mappings, destMapping.mappings);

  const count = await esClient.count({ index: destIndex });

  // Validate that dest-index has the indexed data from the source index
  t.is(3, count.count);

  // Check the reindex status endpoint
  const statusResponse = await request(app)
    .get('/elasticsearch/reindex-status')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const indexStatus = statusResponse.body.indexStatus.indices[destIndex];

  t.is(3, indexStatus.primaries.docs.count)

  await esClient.indices.delete({ index: destIndex });
});

test.serial('Reindex - destination index exists', async (t) => {
  const response = await request(app)
    .put('/elasticsearch/reindex')
    .send({
      aliasName: indexAlias,
      destIndex: esIndex,
      sourceIndex: esIndex
    })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  t.is(response.body.message, `Destination index ${esIndex} exists. Please specify an index name that does not exist.`);
});

test.serial('Reindex status', async (t) => {
  const response = await request(app)
    .get('/elasticsearch/reindex-status')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.deepEqual(response.body.reindexStatus, { nodes: {} });
});

test.serial('Complete index - no source', async (t) => {
  const response = await request(app)
    .put('/elasticsearch/complete-reindex')
    .send({
      aliasName: indexAlias,
      destIndex: 'dest-index'
    })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  t.is(response.body.message, 'Please explicity specify a source and destination index.');
});

test.serial('Complete index - no destination', async (t) => {
  const response = await request(app)
    .put('/elasticsearch/complete-reindex')
    .send({
      aliasName: indexAlias,
      sourceIndex: 'source-index'
    })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  t.is(response.body.message, 'Please explicity specify a source and destination index.');
});

test.serial('Complete index - source index does not exist', async (t) => {
  const sourceIndex = 'source-index';

  const response = await request(app)
    .put('/elasticsearch/complete-reindex')
    .send({
      aliasName: indexAlias,
      sourceIndex,
      destIndex: 'dest-index'
    })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  t.is(response.body.message, `Source index ${sourceIndex} does not exist.`);
});

test.serial('Complete index - no destination', async (t) => {
  const destIndex = 'dest-index';

  const response = await request(app)
    .put('/elasticsearch/complete-reindex')
    .send({
      aliasName: indexAlias,
      sourceIndex: esIndex,
      destIndex
    })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  t.is(response.body.message, `Destination index ${destIndex} does not exist.`);
});

test.serial('Complete index - source index same as dest index', async (t) => {
  const response = await request(app)
    .put('/elasticsearch/complete-reindex')
    .send({
      aliasName: indexAlias,
      sourceIndex: 'source',
      destIndex: 'source'
    })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(400);

  t.is(response.body.message, 'The source index cannot be the same as the destination index.');
});

test.serial('Complete re-index', async (t) => {
  const sourceIndex = randomString();
  const aliasName = randomString();
  const destIndex = randomString();

  await createIndex(sourceIndex, aliasName);

  await request(app)
    .put('/elasticsearch/reindex')
    .send({
      aliasName,
      sourceIndex,
      destIndex
    })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const response = await request(app)
    .put('/elasticsearch/complete-reindex')
    .send({
      aliasName,
      sourceIndex,
      destIndex
    })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.body.message,
    `Reindex success - alias ${aliasName} now pointing to ${destIndex}`);

  const alias = await esClient.indices.getAlias({ name: aliasName });

  // Test that the only index connected to the alias is the destination index
  t.deepEqual(Object.keys(alias), [destIndex]);

  t.is(await esClient.indices.exists({ index: sourceIndex }), true);

  await esClient.indices.delete({ index: destIndex });
});

test.serial('Complete re-index and delete source index', async (t) => {
  const sourceIndex = randomString();
  const aliasName = randomString();
  const destIndex = randomString();

  await createIndex(sourceIndex, aliasName);

  await request(app)
    .put('/elasticsearch/reindex')
    .send({
      aliasName,
      sourceIndex,
      destIndex
    })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const response = await request(app)
    .put('/elasticsearch/complete-reindex')
    .send({
      aliasName,
      sourceIndex,
      destIndex,
      deleteSource: true
    })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.body.message,
    `Reindex success - alias ${aliasName} now pointing to ${destIndex} and index ${sourceIndex} deleted`);
  t.is(await esClient.indices.exists({ index: sourceIndex }), false);

  await esClient.indices.delete({ index: destIndex });
});

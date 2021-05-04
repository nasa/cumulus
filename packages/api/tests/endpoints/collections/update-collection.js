'use strict';

const test = require('ava');
const request = require('supertest');
const awsServices = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  generateLocalTestDb,
  localStackConnectionEnv,
  translateApiCollectionToPostgresCollection,
} = require('@cumulus/db');
const models = require('../../../models');
const bootstrap = require('../../../lambdas/bootstrap');
const {
  createFakeJwtAuthToken,
  fakeCollectionFactory,
  setAuthorizedOAuthUsers,
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const assertions = require('../../../lib/assertions');

process.env.AccessTokensTable = randomString();
process.env.CollectionsTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../../app');

const esIndex = randomString();
let esClient;

let jwtAuthToken;
let accessTokenModel;
let collectionModel;

const testDbName = randomString(12);
process.env = {
  ...process.env,
  ...localStackConnectionEnv,
  PG_DATABASE: testDbName,
};

const { migrationDir } = require('../../../../../lambdas/db-migration');

test.before(async (t) => {
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;
  t.context.collectionPgModel = new CollectionPgModel();

  const esAlias = randomString();
  process.env.ES_INDEX = esAlias;
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex, esAlias);

  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  collectionModel = new models.Collection({ tableName: process.env.CollectionsTable });
  await collectionModel.createTable();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
  esClient = await Search.es('fakehost');
});

test.after.always(async (t) => {
  await accessTokenModel.deleteTable();
  await collectionModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await esClient.indices.delete({ index: esIndex });
  await destroyLocalTestDb({
    knex: t.context.testKnex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
  });
});

test('CUMULUS-911 PUT with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .put('/collections/asdf/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 PUT with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .put('/collections/asdf/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 PUT with pathParameters and with an unauthorized user returns an unauthorized response');

test('PUT replaces an existing collection', async (t) => {
  const knex = t.context.testKnex;
  const originalCollection = fakeCollectionFactory({
    duplicateHandling: 'replace',
    process: randomString(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  const insertPgRecord = await translateApiCollectionToPostgresCollection(originalCollection);
  await collectionModel.create(originalCollection);
  const pgId = await t.context.collectionPgModel.create(t.context.testKnex, insertPgRecord);
  const originalPgRecord = await t.context.collectionPgModel.get(
    knex, { cumulus_id: pgId[0] }
  );

  const updatedCollection = {
    ...originalCollection,
    updatedAt: Date.now(),
    createdAt: Date.now(),
    duplicateHandling: 'error',
  };
  delete updatedCollection.process;

  await request(app)
    .put(`/collections/${originalCollection.name}/${originalCollection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updatedCollection)
    .expect(200);

  const actualCollection = await collectionModel.get({
    name: originalCollection.name,
    version: originalCollection.version,
  });

  const actualPgCollection = await t.context.collectionPgModel.get(knex, {
    name: originalCollection.name,
    version: originalCollection.version,
  });

  t.like(actualCollection, {
    ...originalCollection,
    duplicateHandling: 'error',
    process: undefined,
    createdAt: originalCollection.createdAt,
    updatedAt: actualCollection.updatedAt,
  });

  t.deepEqual(actualPgCollection, {
    ...originalPgRecord,
    duplicate_handling: 'error',
    process: null,
    created_at: originalPgRecord.created_at,
    updated_at: actualPgCollection.updated_at,
  });
});

test('PUT replaces an existing collection in Dynamo and PG with correct timestamps', async (t) => {
  const knex = t.context.testKnex;
  const originalCollection = fakeCollectionFactory({
    duplicateHandling: 'replace',
    process: randomString(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  await collectionModel.create(originalCollection);

  const updatedCollection = {
    ...originalCollection,
    updatedAt: Date.now(),
    createdAt: Date.now(),
    duplicateHandling: 'error',
  };

  await request(app)
    .put(`/collections/${originalCollection.name}/${originalCollection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updatedCollection)
    .expect(200);

  const actualCollection = await collectionModel.get({
    name: originalCollection.name,
    version: originalCollection.version,
  });

  const actualPgCollection = await t.context.collectionPgModel.get(knex, {
    name: originalCollection.name,
    version: originalCollection.version,
  });

  // Endpoint logic will set an updated timestamp and ignore the value from the request
  // body, so value on actual records should be different (greater) than the value
  // sent in the request body
  t.true(actualCollection.updatedAt > updatedCollection.updatedAt);
  // createdAt timestamp from original record should have been preserved
  t.is(actualCollection.createdAt, originalCollection.createdAt);
  // PG and Dynamo records have the same timestamps
  t.is(actualPgCollection.created_at.getTime(), actualCollection.createdAt);
  t.is(actualPgCollection.updated_at.getTime(), actualCollection.updatedAt);
});

test('PUT creates a new record in RDS if one does not exist', async (t) => {
  const knex = t.context.testKnex;
  const originalCollection = fakeCollectionFactory({
    duplicateHandling: 'replace',
    process: randomString(),
  });

  await collectionModel.create(originalCollection);

  const updatedCollection = {
    ...originalCollection,
    duplicateHandling: 'error',
  };

  delete updatedCollection.process;

  await request(app)
    .put(`/collections/${originalCollection.name}/${originalCollection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updatedCollection)
    .expect(200);

  const fetchedDynamoRecord = await collectionModel.get({
    name: updatedCollection.name,
    version: updatedCollection.version,
  });

  const fetchedDbRecord = await t.context.collectionPgModel.get(knex, {
    name: originalCollection.name, version: originalCollection.version,
  });

  t.is(fetchedDbRecord.name, originalCollection.name);
  t.is(fetchedDbRecord.version, originalCollection.version);
  t.is(fetchedDbRecord.duplicate_handling, 'error');
  // eslint-disable-next-line unicorn/no-null
  t.is(fetchedDbRecord.process, null);
  t.is(fetchedDbRecord.created_at.getTime(), fetchedDynamoRecord.createdAt);
  t.is(fetchedDbRecord.updated_at.getTime(), fetchedDynamoRecord.updatedAt);
});

test('PUT returns 404 for non-existent collection', async (t) => {
  const name = randomString();
  const version = randomString();
  const response = await request(app)
    .put(`/collections/${name}/${version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ name, version })
    .expect(404);
  const { message, record } = response.body;

  t.truthy(message);
  t.falsy(record);
});

test('PUT returns 400 for name mismatch between params and payload',
  async (t) => {
    const name = randomString();
    const version = randomString();
    const response = await request(app)
      .put(`/collections/${name}/${version}`)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send({ name: randomString(), version })
      .expect(400);
    const { message, record } = response.body;

    t.truthy(message);
    t.falsy(record);
  });

test('PUT returns 400 for version mismatch between params and payload',
  async (t) => {
    const name = randomString();
    const version = randomString();
    const response = await request(app)
      .put(`/collections/${name}/${version}`)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send({ name, version: randomString() })
      .expect(400);
    const { message, record } = response.body;

    t.truthy(message);
    t.falsy(record);
  });

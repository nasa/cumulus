'use strict';

const test = require('ava');
const request = require('supertest');
const rewire = require('rewire');
const sinon = require('sinon');

const awsServices = require('@cumulus/aws-client/services');
const s3 = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');
const { bootstrapElasticSearch } = require('@cumulus/es-client/bootstrap');
const indexer = rewire('@cumulus/es-client/indexer');
const { getEsClient } = require('@cumulus/es-client/search');

const {
  destroyLocalTestDb,
  generateLocalTestDb,
  GranulePgModel,
  CollectionPgModel,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  migrationDir,
  localStackConnectionEnv,
  fakeReconciliationReportRecordFactory,
  ReconciliationReportPgModel,
} = require('@cumulus/db');

const models = require('../../models');
const {
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers,
} = require('../../lib/testUtils');

const testDbName = randomId('collection');

const assertions = require('../../lib/assertions');

const stats = rewire('../../endpoints/stats');
const getType = stats.__get__('getType');

let esClient;

process.env.AccessTokensTable = randomId('accessTokenTable');

process.env.system_bucket = randomId('bucket');
process.env.stackName = randomId('stackName');

const esIndex = randomId('esindex');
const esAlias = randomId('esAlias');

process.env.ES_INDEX = esAlias;
process.env.TOKEN_SECRET = randomId('tokensecret');

// import the express app after setting the env variables
const { app } = require('../../app');

let accessTokenModel;
let jwtAuthToken;

test.before(async () => {
  // create buckets
  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket });
  esClient = await getEsClient();
  const username = randomId();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  // create the elasticsearch index and add mapping
  await bootstrapElasticSearch({
    host: 'fakehost',
    index: esIndex,
    alias: esAlias,
  });
  // Index test data - 2 collections, 3 granules
  await Promise.all([
    indexer.indexCollection(esClient, fakeCollectionFactory(), esAlias),
    indexer.indexCollection(esClient, fakeCollectionFactory(), esAlias),
    indexer.indexGranule(esClient, fakeGranuleFactoryV2({ collectionId: 'coll1' }), esAlias),
    indexer.indexGranule(esClient, fakeGranuleFactoryV2({ collectionId: 'coll1' }), esAlias),
    indexer.indexGranule(esClient, fakeGranuleFactoryV2({ status: 'failed', duration: 3 }), esAlias),
  ]);

  // Indexing using Date.now() to generate the timestamp
  const stub = sinon.stub(Date, 'now').returns((new Date(2020, 0, 29)).getTime());

  t.context.collectionPgModel = new CollectionPgModel();
  t.context.granulePgModel = new GranulePgModel();
  t.context.reconciliationReportPgModel = new ReconciliationReportPgModel();

  const statuses = ['queued', 'failed', 'completed', 'running'];
  const errors = [{ Error: 'UnknownError' }, { Error: 'CumulusMessageAdapterError' }, { Error: 'IngestFailure' }, { Error: 'CmrFailure' }, {}];
  const reconReportTypes = ['Granule Inventory', 'Granule Not Found', 'Inventory', 'ORCA Backup'];
  const reconReportStatuses = ['Generated', 'Pending', 'Failed'];

  const collections = range(20).map((num) => fakeCollectionRecordFactory({
    name: `testCollection${num}`,
    cumulus_id: num,
  }));

  const granules = range(100).map((num) => fakeGranuleRecordFactory({
    collection_cumulus_id: num % 20,
    status: statuses[num % 4],
    created_at: num === 99
      ? new Date() : (new Date(2018 + (num % 6), (num % 12), (num % 30))),
    updated_at: num === 99
      ? new Date() : (new Date(2018 + (num % 6), (num % 12), ((num + 1) % 29))),
    error: errors[num % 5],
    duration: num + (num / 10),
  }));

  const reconReports = range(24).map((num) => fakeReconciliationReportRecordFactory({
    type: reconReportTypes[num % 4],
    status: reconReportStatuses[num % 3],
    created_at: (new Date(2024 + (num % 6), (num % 12), (num % 30))),
    updated_at: (new Date(2024 + (num % 6), (num % 12), ((num + 1) % 29))),
  }));

  await t.context.collectionPgModel.insert(t.context.knex, collections);
  await t.context.granulePgModel.insert(t.context.knex, granules);
  await t.context.reconciliationReportPgModel.insert(t.context.knex, reconReports);
});

test.after.always(async () => {
  await Promise.all([
    esClient.client.indices.delete({ index: esIndex }),
    await accessTokenModel.deleteTable(),
    s3.recursivelyDeleteS3Bucket(process.env.system_bucket),
  ]);
});

test('GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/stats')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('GET /stats/aggregate without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/stats/aggregate')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('GET without pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/stats/')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('GET without pathParameters and with an unauthorized user returns an unauthorized response');

test('GET /stats/aggregate with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/stats/aggregate')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test('getType gets correct type for granules', (t) => {
  const type = getType({ params: { type: 'granules' } });

  t.is(type, 'granule');
});

test('getType gets correct type for collections', (t) => {
  const type = getType({ params: { type: 'collections' } });

  t.is(type, 'collection');
});

test('getType gets correct type for pdrs', (t) => {
  const type = getType({ params: { type: 'pdrs' } });

  t.is(type, 'pdr');
});

test('getType gets correct type for executions', (t) => {
  const type = getType({ params: { type: 'executions' } });

  t.is(type, 'execution');
});

test('getType gets correct type for logs', (t) => {
  const type = getType({ params: { type: 'logs' } });

  t.is(type, 'logs');
});

test('getType gets correct type for providers', (t) => {
  const type = getType({ params: { type: 'providers' } });

  t.is(type, 'provider');
});

test('getType gets correct type for reconciliation reports', (t) => {
  const type = getType({ params: { type: 'reconciliationReports' } });

  t.is(type, 'reconciliationReport');
});

test('getType returns undefined if type is not supported', (t) => {
  const type = getType({ params: { type: 'provide' } });

  t.falsy(type);
});

test('getType returns correct type from query params', (t) => {
  const type = getType({ query: { type: 'providers' } });

  t.is(type, 'provider');
});

test('GET /stats returns correct response, defaulted to all', async (t) => {
  const response = await request(app)
    .get('/stats')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.body.errors.value, 2);
  t.is(response.body.collections.value, 2);
  t.is(response.body.processingTime.value, 2.2);
  t.is(response.body.granules.value, 5);
});

test('GET /stats returns correct response with date params filters values correctly', async (t) => {
  const response = await request(app)
    .get(`/stats?timestamp__from=${(new Date(2020, 0, 28)).getTime()}&timestamp__to=${(new Date(2020, 0, 30)).getTime()}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.body.errors.value, 1);
  t.is(response.body.collections.value, 1);
  t.is(response.body.processingTime.value, 4);
  t.is(response.body.granules.value, 2);
});

test('GET /stats/aggregate with type `granules` returns correct response', async (t) => {
  const response = await request(app)
    .get('/stats/aggregate?type=granules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.body.meta.count, 5);
  t.deepEqual(response.body.count, [
    { key: 'completed', count: 3 }, { key: 'failed', count: 2 },
  ]);
});

test('GET /stats/aggregate with type `granules` filters correctly by date', async (t) => {
  const response = await request(app)
    .get(`/stats/aggregate?type=granules&timestamp__from=${(new Date(2020, 0, 28)).getTime()}&timestamp__to=${(new Date(2020, 0, 30)).getTime()}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.body.meta.count, 2);
  t.deepEqual(response.body.count, [
    { key: 'completed', count: 1 }, { key: 'failed', count: 1 },
  ]);
});

test('GET /stats/aggregate with type `reconciliationReports` and field `type` returns the correct response', async (t) => {
  const response = await request(app)
    .get('/stats/aggregate?type=reconciliationReports&field=type')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const expectedCount = [
    { key: 'Granule Inventory', count: 6 },
    { key: 'Granule Not Found', count: 6 },
    { key: 'Inventory', count: 6 },
    { key: 'ORCA Backup', count: 6 },
  ];

  t.is(response.body.meta.count, 24);
  t.deepEqual(response.body.count, expectedCount);
});

test('GET /stats/aggregate with type `reconciliationReports` and field `status` returns the correct response', async (t) => {
  const response = await request(app)
    .get('/stats/aggregate?type=reconciliationReports&field=status')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const expectedCount = [
    { key: 'Failed', count: 8 },
    { key: 'Generated', count: 8 },
    { key: 'Pending', count: 8 },
  ];

  t.is(response.body.meta.count, 24);
  t.deepEqual(response.body.count, expectedCount);
});

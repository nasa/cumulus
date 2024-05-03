'use strict';

const test = require('ava');
const request = require('supertest');
const rewire = require('rewire');
const sinon = require('sinon');
const cryptoRandomString = require('crypto-random-string');

const awsServices = require('@cumulus/aws-client/services');
const s3 = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');
const { bootstrapElasticSearch } = require('@cumulus/es-client/bootstrap');
const indexer = rewire('@cumulus/es-client/indexer');
const { getEsClient } = require('@cumulus/es-client/search');
const { StatsSearch } = require('@cumulus/db/dist/search/StatsSearch');
const models = require('../../models');

const {
  fakeGranuleFactoryV2,
  fakeCollectionFactory,
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers,
} = require('../../lib/testUtils');

const {
  destroyLocalTestDb,
  generateLocalTestDb,
  GranulePgModel,
  CollectionPgModel,
  fakeCollectionRecordFactory,
  fakeGranuleRecordFactory,
  fakeProviderRecordFactory,
  migrationDir,
  fakePdrRecordFactory,
  fakeExecutionRecordFactory,
  PdrPgModel,
  ExecutionPgModel,
  ProviderPgModel,
} = require('../../../db/dist');

const testDbName = `collection_${cryptoRandomString({ length: 10 })}`;

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

test.before(async (t) => {
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

  await Promise.all([
    indexer.indexCollection(esClient, fakeCollectionFactory({
      updatedAt: new Date(2020, 0, 29),
    }), esAlias),
    indexer.indexGranule(esClient, fakeGranuleFactoryV2({
      status: 'failed',
      updatedAt: new Date(2020, 0, 29),
      duration: 4,
    }), esAlias),
    indexer.indexGranule(esClient, fakeGranuleFactoryV2({
      updatedAt: new Date(2020, 0, 29),
      duration: 4,
    }), esAlias),
  ]);
  stub.restore();

  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );

  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.collectionPgModel = new CollectionPgModel();
  t.context.granulePgModel = new GranulePgModel();
  t.context.providerPgModel = new ProviderPgModel();
  t.context.PdrPgModel = new PdrPgModel();
  t.context.ExecutionPgModel = new ExecutionPgModel();

  const collection1 = fakeCollectionRecordFactory({ name: 'testCollection', version: 'v3' });
  const collection2 = fakeCollectionRecordFactory({ name: 'testCollection2', version: 'v2' });
  const collection3 = fakeCollectionRecordFactory({ name: 'testCollection3', version: 'v1' });

  const pgCollections = await t.context.collectionPgModel.insert(
    t.context.knex,
    [collection1, collection2, collection3],
    '*'
  );

  const statuses = ['queued', 'failed', 'completed', 'running'];
  const errors = [{ Error: { keyword: 'UnknownError' } }, { Error: { keyword: 'CumulusMessageAdapterError' } }, { Error: { keyword: 'IngestFailure' } }, { Error: { keyword: 'CmrFailure' } }];
  const granules = [];
  const executions = [];
  const pdrs = [];
  const providers = [];

  for (let i = 0; i < 10; i++) {
    granules.push(fakeGranuleRecordFactory({
      collection_cumulus_id: pgCollections[i % 3].cumulus_id,
      status: statuses[i % 4],
      beginning_date_time: (new Date(2019, 0, 28)).toISOString(),
      ending_date_time: (new Date(2024, 5, 30)).toISOString(),
      error: errors[i % 4],
    }));

    pdrs.push(fakePdrRecordFactory({
      collection_cumulus_id: pgCollections[i % 3].cumulus_id,
      status: statuses[(i % 3) + 1],
      provider_cumulus_id: i % 10,
      created_at: (new Date(2018, 1, 28)).toISOString(),
      updated_at: (new Date(2024, 5, 30)).toISOString(),
    }));

    executions.push(fakeExecutionRecordFactory({
      collection_cumulus_id: pgCollections[i % 3].cumulus_id,
      status: statuses[(i % 3) + 1],
      error: errors[i % 4],
      created_at: (new Date(2019, 1, 28)).toISOString(),
      updated_at: (new Date(2024, 5, 30)).toISOString(),
    }));

    providers.push(fakeProviderRecordFactory({
      cumulus_id: i % 10,
    }));
  }
  await t.context.providerPgModel.insert(
    t.context.knex,
    providers
  );

  await t.context.granulePgModel.insert(
    t.context.knex,
    granules
  );

  await t.context.ExecutionPgModel.insert(
    t.context.knex,
    executions
  );

  await t.context.PdrPgModel.insert(
    t.context.knex,
    pdrs
  );
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });

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

test('GET /stats/aggregate returns correct response', async (t) => {
  const { knex } = t.context;
  const AggregateSearch = new StatsSearch('/stats/aggregate?type=granules');

  const expectedResponse = [
    { status: 'queued', count: '3' },
    { status: 'failed', count: '3' },
    { status: 'completed', count: '2' },
    { status: 'running', count: '2' },
  ];

  t.deepEqual(await AggregateSearch.aggregate_search(knex), expectedResponse);
});

test('GET /stats/aggregate filters correctly by date', async (t) => {
  const { knex } = t.context;
  const AggregateSearch = new StatsSearch(`/stats/aggregate?type=granules&timestamp__from=${(new Date(2020, 0, 28)).getTime()}&timestamp__to=${(new Date(2024, 2, 30)).getTime()}`);

  const expectedResponse = [
    { status: 'queued', count: '3' },
    { status: 'failed', count: '3' },
    { status: 'running', count: '2' },
    { status: 'completed', count: '2' },
  ];

  t.deepEqual(await AggregateSearch.aggregate_search(knex), expectedResponse);
});

test('GET /stats/aggregate filters executions correctly', async (t) => {
  const { knex } = t.context;
  const AggregateSearch = new StatsSearch('/stats/aggregate?type=executions&field=status');

  const expectedResponse = [
    { count: '4', status: 'failed' },
    { count: '3', status: 'completed' },
    { count: '3', status: 'running' },
  ];
  const AggregateSearch2 = new StatsSearch(`/stats/aggregate?type=executions&field=status&timestamp__from=${(new Date(2020, 0, 28)).getTime()}&timestamp__to=${(new Date(2024, 2, 30)).getTime()}`);

  const expectedResponse2 = [
    { status: 'failed', count: '4' },
    { status: 'running', count: '3' },
    { status: 'completed', count: '3' },
  ];

  t.deepEqual(await AggregateSearch2.aggregate_search(knex), expectedResponse2);
  t.deepEqual(await AggregateSearch.aggregate_search(knex), expectedResponse);
});

test('GET /stats/aggregate filters PDRs correctly', async (t) => {
  const { knex } = t.context;
  const AggregateSearch = new StatsSearch('/stats/aggregate?type=pdrs&field=status');

  const expectedResponse = [
    { status: 'failed', count: '4' },
    { status: 'completed', count: '3' },
    { status: 'running', count: '3' },
  ];

  const AggregateSearch2 = new StatsSearch(`/stats/aggregate?type=pdrs&field=status&timestamp__from=${(new Date(2020, 0, 28)).getTime()}&timestamp__to=${(new Date(2024, 2, 30)).getTime()}`);

  const expectedResponse2 = [
    { status: 'failed', count: '4' },
    { status: 'running', count: '3' },
    { status: 'completed', count: '3' },
  ];

  t.deepEqual(await AggregateSearch2.aggregate_search(knex), expectedResponse2);
  t.deepEqual(await AggregateSearch.aggregate_search(knex), expectedResponse);
});

test('GET /stats/aggregate returns correct response when queried by error', async (t) => {
  const { knex } = t.context;
  const AggregateSearch = new StatsSearch('/stats/aggregate?type=granules&field=error.Error.keyword');

  const expectedResponse = [
    { error: 'CumulusMessageAdapterError', count: '3' },
    { error: 'UnknownError', count: '3' },
    { error: 'CmrFailure', count: '2' },
    { error: 'IngestFailure', count: '2' },
  ];

  t.deepEqual(await AggregateSearch.aggregate_search(knex), expectedResponse);
});

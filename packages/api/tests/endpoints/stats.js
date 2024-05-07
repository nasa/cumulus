'use strict';

const test = require('ava');
const request = require('supertest');
const rewire = require('rewire');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');

const awsServices = require('@cumulus/aws-client/services');
const s3 = require('@cumulus/aws-client/S3');
const { randomString, randomId } = require('@cumulus/common/test-utils');

const models = require('../../models');
const {
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
  migrationDir,
  localStackConnectionEnv,
} = require('../../../db/dist');

const testDbName = `collection_${cryptoRandomString({ length: 10 })}`;

const assertions = require('../../lib/assertions');

const stats = rewire('../../endpoints/stats');
const getType = stats.__get__('getType');

process.env.AccessTokensTable = randomId('accessTokenTable');

process.env.system_bucket = randomId('bucket');
process.env.stackName = randomId('stackName');

const esAlias = randomId('esAlias');

process.env.ES_INDEX = esAlias;
process.env.TOKEN_SECRET = randomId('tokensecret');

// import the express app after setting the env variables
const { app } = require('../../app');

let accessTokenModel;
let jwtAuthToken;

process.env.PG_HOST = `hostname_${cryptoRandomString({ length: 10 })}`;
process.env.PG_USER = `user_${cryptoRandomString({ length: 10 })}`;
process.env.PG_PASSWORD = `password_${cryptoRandomString({ length: 10 })}`;
process.env.stackName = randomString();
process.env = {
  ...process.env,
  ...localStackConnectionEnv,
  PG_DATABASE: testDbName,
};

test.before(async (t) => {
  // create buckets
  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket });
  const username = randomId();
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
  t.context.granulePgModel = new GranulePgModel();

  const statuses = ['queued', 'failed', 'completed', 'running'];
  const errors = [{ Error: { keyword: 'UnknownError' } }, { Error: { keyword: 'CumulusMessageAdapterError' } }, { Error: { keyword: 'IngestFailure' } }, { Error: { keyword: 'CmrFailure' } }, { Error: {} }];
  const granules = [];
  const collections = [];

  range(20).map((num) => (
    // collections is never aggregate queried
    collections.push(fakeCollectionRecordFactory({
      name: `testCollection${num}`,
      cumulus_id: num,
    }))
  ));

  range(100).map((num) => (
    // granules can be queried by timestampto/from, collectionid, providerid, status,
    granules.push(fakeGranuleRecordFactory({
      collection_cumulus_id: num % 20,
      status: statuses[num % 4],
      created_at: (new Date(2018 + (num % 6), (num % 12), (num % 30))).toISOString(),
      updated_at: (new Date(2018 + (num % 6), (num % 12), ((num + 1) % 29))).toISOString(),
      error: errors[num % 5],
      time_to_process: num + (num / 10),
    }))
  ));

  await t.context.collectionPgModel.insert(
    t.context.knex,
    collections
  );

  await t.context.granulePgModel.insert(
    t.context.knex,
    granules
  );
});

test.after.always(async (t) => {
  await Promise.all([
    await accessTokenModel.deleteTable(),
    s3.recursivelyDeleteS3Bucket(process.env.system_bucket),
  ]);

  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
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

  const expectedResponse = [
    {
      count_errors: '80',
      count_granules: '100',
      avg_processing_time: 54.44999999642372,
      count_collections: '20',
    },
  ];
  t.deepEqual(response.body, expectedResponse);
});

test('GET /stats returns correct response with date params filters values correctly', async (t) => {
  const response = await request(app)
    .get(`/stats?timestamp__from=${(new Date(2018, 1, 28)).getTime()}&timestamp__to=${(new Date(2019, 1, 30)).getTime()}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const expectedResponse = [
    {
      count_errors: '15',
      count_granules: '17',
      avg_processing_time: 53.38235317258274,
      count_collections: '10',
    },
  ];

  t.deepEqual(response.body, expectedResponse);
});

test('GET /stats/aggregate returns correct response', async (t) => {
  const response = await request(app)
    .get('/stats/aggregate?type=granules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const expectedResponse = [
    { status: 'completed', count: '25' },
    { status: 'running', count: '25' },
    { status: 'queued', count: '25' },
    { status: 'failed', count: '25' },
  ];

  t.deepEqual(response.body, expectedResponse);
});

test('GET /stats/aggregate filters correctly by date', async (t) => {
  const response = await request(app)
    .get(`/stats/aggregate?type=granules&timestamp__from=${(new Date(2020, 11, 28)).getTime()}&timestamp__to=${(new Date(2023, 8, 30)).getTime()}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const expectedResponse = [
    { status: 'failed', count: '16' },
    { status: 'running', count: '9' },
    { status: 'completed', count: '8' },
    { status: 'queued', count: '8' },
  ];

  t.deepEqual(response.body, expectedResponse);
});

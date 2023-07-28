'use strict';

const test = require('ava');
const sinon = require('sinon');
const request = require('supertest');
const omit = require('lodash/omit');

const {
  localStackConnectionEnv,
  generateLocalTestDb,
  destroyLocalTestDb,
  translateApiProviderToPostgresProvider,
  nullifyUndefinedProviderValues,
  ProviderPgModel,
  migrationDir,
} = require('@cumulus/db');
const { s3 } = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const { RecordDoesNotExist } = require('@cumulus/errors');
const { Search } = require('@cumulus/es-client/search');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');

const AccessToken = require('../../../models/access-tokens');
const {
  createFakeJwtAuthToken,
  fakeProviderFactory,
  setAuthorizedOAuthUsers,
} = require('../../../lib/testUtils');
const assertions = require('../../../lib/assertions');
const { post } = require('../../../endpoints/providers');

const { buildFakeExpressResponse } = require('../utils');

const testDbName = randomString(12);
process.env.AccessTokensTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();
process.env = {
  ...process.env,
  ...localStackConnectionEnv,
  PG_DATABASE: testDbName,
};

// import the express app after setting the env variables
const { app } = require('../../../app');

let jwtAuthToken;
let accessTokenModel;

const providerDoesNotExist = async (t, name) => {
  await t.throwsAsync(
    () => t.context.providerPgModel.get(t.context.testKnex, { name }),
    { instanceOf: RecordDoesNotExist }
  );
};

test.before(async (t) => {
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;
  t.context.providerPgModel = new ProviderPgModel();

  await s3().createBucket({ Bucket: process.env.system_bucket });

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.esProviderClient = new Search(
    {},
    'provider',
    t.context.esIndex
  );

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await accessTokenModel.deleteTable();
  await cleanupTestIndex(t.context);
  await destroyLocalTestDb({
    knex: t.context.testKnex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
  });
});

test('CUMULUS-911 POST without an Authorization header returns an Authorization Missing response', async (t) => {
  const newProvider = fakeProviderFactory();

  const response = await request(app)
    .post('/providers')
    .send(newProvider)
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
  await providerDoesNotExist(t, newProvider.id);
});

test('CUMULUS-912 POST with an invalid access token returns an unauthorized response', async (t) => {
  const newProvider = fakeProviderFactory();
  const response = await request(app)
    .post('/providers')
    .send(newProvider)
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
  await providerDoesNotExist(t, newProvider.id);
});

test.todo('CUMULUS-912 POST with an unauthorized user returns an unauthorized response');

test('POST with invalid authorization scheme returns an invalid authorization response', async (t) => {
  const newProvider = fakeProviderFactory();

  const response = await request(app)
    .post('/providers')
    .send(newProvider)
    .set('Accept', 'application/json')
    .set('Authorization', 'InvalidBearerScheme ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAuthorizationResponse(t, response);
  await providerDoesNotExist(t, newProvider.id);
});

test('POST creates a new provider in all data stores', async (t) => {
  const { providerPgModel } = t.context;
  const newProviderId = randomString();
  const newProvider = fakeProviderFactory({
    id: newProviderId,
  });
  const postgresExpectedProvider = await translateApiProviderToPostgresProvider(newProvider);

  const postgresOmitList = ['created_at', 'updated_at', 'cumulus_id'];

  const response = await request(app)
    .post('/providers')
    .send(newProvider)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { message, record } = response.body;
  const pgRecords = await providerPgModel.search(
    t.context.testKnex,
    { name: newProviderId }
  );

  t.is(message, 'Record saved');
  t.is(record.id, newProviderId);
  t.is(pgRecords.length, 1);

  const [providerPgRecord] = pgRecords;

  t.deepEqual(
    omit(providerPgRecord, postgresOmitList),
    omit(
      nullifyUndefinedProviderValues(postgresExpectedProvider),
      postgresOmitList
    )
  );

  const esRecord = await t.context.esProviderClient.get(
    newProvider.id
  );
  t.like(esRecord, record);
});

test('POST creates a new provider in PG with correct timestamps', async (t) => {
  const { providerPgModel } = t.context;
  const newProviderId = randomString();
  const newProvider = fakeProviderFactory({
    id: newProviderId,
  });

  const response = await request(app)
    .post('/providers')
    .send(newProvider)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { record } = response.body;
  const pgRecords = await providerPgModel.search(
    t.context.testKnex,
    { name: newProviderId }
  );

  const [providerPgRecord] = pgRecords;

  t.true(record.createdAt > newProvider.createdAt);
  t.true(record.updatedAt > newProvider.updatedAt);

  const esRecord = await t.context.esProviderClient.get(
    newProvider.id
  );

  // PG and ES and returned API records have the same timestamps
  t.is(providerPgRecord.created_at.getTime(), record.createdAt);
  t.is(providerPgRecord.updated_at.getTime(), record.updatedAt);
  t.is(providerPgRecord.created_at.getTime(), esRecord.createdAt);
  t.is(providerPgRecord.updated_at.getTime(), esRecord.updatedAt);
});

test('POST returns a 409 error if the provider already exists in postgres', async (t) => {
  const newProvider = fakeProviderFactory();

  await t.context.providerPgModel.create(
    t.context.testKnex,
    await translateApiProviderToPostgresProvider(newProvider)
  );
  const response = await request(app)
    .post('/providers')
    .send(newProvider)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(409);

  const { message } = response.body;
  t.is(message, (`A record already exists for ${newProvider.id}`));
});

test.serial('POST returns a 500 response if record creation throws unexpected error', async (t) => {
  const stub = sinon.stub(ProviderPgModel.prototype, 'create')
    .callsFake(() => {
      throw new Error('unexpected error');
    });
  const newProvider = fakeProviderFactory();

  try {
    const response = await request(app)
      .post('/providers')
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send(newProvider)
      .expect(500);
    t.is(response.status, 500);
  } finally {
    stub.restore();
  }
});

test('POST returns a 400 response if invalid record is provided', async (t) => {
  const newProvider = { foo: 'bar' };

  const response = await request(app)
    .post('/providers')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newProvider)
    .expect(400);
  t.is(response.status, 400);
});

test('POST returns a 400 response if invalid hostname is provided', async (t) => {
  const newProvider = fakeProviderFactory({
    host: '-bad-hostname',
  });

  const response = await request(app)
    .post('/providers')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newProvider)
    .expect(400);
  t.is(response.status, 400);
});

test('CUMULUS-176 POST returns a 404 if the requested path does not exist', async (t) => {
  const newProvider = fakeProviderFactory();

  const response = await request(app)
    .post(`/providers/${newProvider.providerid}`)
    .send(newProvider)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);

  t.is(response.statusCode, 404);
});

test('CUMULUS-176 POST returns a 400 response if invalid JSON provided', async (t) => {
  const response = await request(app)
    .post('/providers')
    .set('Content-Type', 'application/json')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send('asdf');

  t.is(response.statusCode, 400);
  t.true(
    /Unexpected.*JSON/.test(response.text),
    `response.text: ${response.text}`
  );
});

test('post() does not write to Elasticsearch if writing to PostgreSQL fails', async (t) => {
  const provider = fakeProviderFactory();

  const fakeProviderPgModel = {
    create: () => Promise.reject(new Error('something bad')),
    exists: () => false,
  };

  const expressRequest = {
    body: provider,
    testContext: {
      providerPgModel: fakeProviderPgModel,
    },
  };

  const response = buildFakeExpressResponse();

  await post(expressRequest, response);

  t.true(response.boom.badImplementation.calledWithMatch('something bad'));

  t.false(await t.context.esProviderClient.exists(
    provider.id
  ));
});

test('post() does not write to PostgreSQL if writing to Elasticsearch fails', async (t) => {
  const provider = fakeProviderFactory();

  const fakeEsClient = {
    index: () => Promise.reject(new Error('something bad')),
  };

  const expressRequest = {
    body: provider,
    testContext: {
      esClient: fakeEsClient,
    },
  };

  const response = buildFakeExpressResponse();

  await post(expressRequest, response);

  t.true(response.boom.badImplementation.calledWithMatch('something bad'));

  t.false(
    await t.context.providerPgModel.exists(t.context.testKnex, {
      name: provider.id,
    })
  );
});

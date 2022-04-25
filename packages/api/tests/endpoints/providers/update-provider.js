'use strict';

const omit = require('lodash/omit');
const test = require('ava');
const request = require('supertest');
const { s3 } = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const {
  destroyLocalTestDb,
  generateLocalTestDb,
  localStackConnectionEnv,
  nullifyUndefinedProviderValues,
  translateApiProviderToPostgresProvider,
  ProviderPgModel,
  migrationDir,
  fakeProviderRecordFactory,
} = require('@cumulus/db');
const { Search } = require('@cumulus/es-client/search');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');

const models = require('../../../models');
const {
  createFakeJwtAuthToken,
  fakeProviderFactory,
  setAuthorizedOAuthUsers,
  createProviderTestRecords,
} = require('../../../lib/testUtils');

const assertions = require('../../../lib/assertions');
const { put } = require('../../../endpoints/providers');
const { buildFakeExpressResponse } = require('../utils');

const testDbName = randomString(12);

process.env.ProvidersTable = randomString();
process.env.RulesTable = randomString();
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

let providerModel;
let accessTokenModel;
let jwtAuthToken;

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

  const rulesModel = new models.Rule({ tableName: process.env.RulesTable });
  await rulesModel.createTable();
  providerModel = new models.Provider();
  t.context.providerModel = providerModel;
  await providerModel.createTable();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  process.env.AccessTokensTable = randomString();
  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
});

test.beforeEach(async (t) => {
  t.context.testProvider = {
    ...fakeProviderFactory(),
    cmKeyId: 'key',
  };
  t.context.testPostgresProvider = await translateApiProviderToPostgresProvider(
    t.context.testProvider
  );
  await t.context.providerPgModel.create(t.context.testKnex, t.context.testPostgresProvider);
  await providerModel.create(t.context.testProvider);
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await accessTokenModel.deleteTable();
  await providerModel.deleteTable();
  await cleanupTestIndex(t.context);
  await destroyLocalTestDb({
    knex: t.context.testKnex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
  });
});

test('CUMULUS-912 PUT with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .put('/providers/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 PUT with pathParameters and with an unauthorized user returns an unauthorized response');

test('PUT updates existing provider', async (t) => {
  const { testProvider, testProvider: { id } } = t.context;
  const expectedProvider = omit(testProvider,
    ['globalConnectionLimit', 'protocol', 'cmKeyId']);
  const postgresExpectedProvider = await translateApiProviderToPostgresProvider(expectedProvider);
  const postgresOmitList = ['cumulus_id'];
  // Make sure testProvider contains values for the properties we omitted from
  // expectedProvider to confirm that after we replace (PUT) the provider those
  // properties are dropped from the stored provider.
  t.truthy(testProvider.globalConnectionLimit);
  t.truthy(testProvider.protocol);
  t.truthy(testProvider.cmKeyId);

  const updatedProvider = {
    ...expectedProvider,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await request(app)
    .put(`/providers/${id}`)
    .send(updatedProvider)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const actualProvider = await providerModel.get({ id });
  const actualPostgresProvider = await t.context.providerPgModel.get(
    t.context.testKnex,
    { name: id }
  );

  t.deepEqual(actualProvider, {
    ...expectedProvider,
    protocol: 'http', // Default value added by schema rule
    createdAt: expectedProvider.createdAt,
    updatedAt: actualProvider.updatedAt,
  });

  t.deepEqual(
    omit(
      actualPostgresProvider,
      postgresOmitList
    ),
    omit(
      nullifyUndefinedProviderValues({
        ...postgresExpectedProvider,
        protocol: 'http', // Default value, added by RDS rule,
        created_at: postgresExpectedProvider.created_at,
        updated_at: actualPostgresProvider.updated_at,
      }),
      postgresOmitList
    )
  );

  const updatedEsRecord = await t.context.esProviderClient.get(
    testProvider.id
  );
  t.like(
    updatedEsRecord,
    {
      ...expectedProvider,
      updatedAt: actualProvider.updatedAt,
      timestamp: updatedEsRecord.timestamp,
    }
  );
});

test('PUT updates existing provider and correctly removes fields', async (t) => {
  const globalConnectionLimit = 10;
  const testProvider = fakeProviderFactory({
    protocol: 'http',
    globalConnectionLimit,
  });
  const { id } = testProvider;
  await request(app)
    .post('/providers')
    .send(testProvider)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const originalDynamoProvider = await providerModel.get({ id });
  const originalPostgresProvider = await t.context.providerPgModel.get(
    t.context.testKnex,
    { name: id }
  );

  t.is(originalDynamoProvider.globalConnectionLimit, globalConnectionLimit);
  t.is(originalPostgresProvider.global_connection_limit, globalConnectionLimit);

  const updatedProvider = {
    ...testProvider,
  };
  // remove field
  delete updatedProvider.globalConnectionLimit;

  await request(app)
    .put(`/providers/${updatedProvider.id}`)
    .send(updatedProvider)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const actualProvider = await providerModel.get({ id });
  const actualPostgresProvider = await t.context.providerPgModel.get(
    t.context.testKnex,
    { name: id }
  );

  t.is(actualProvider.globalConnectionLimit, undefined);
  t.is(actualPostgresProvider.global_connection_limit, null);
});

test('PUT updates existing provider in all data stores with correct timestamps', async (t) => {
  const { testProvider, testProvider: { id } } = t.context;
  const expectedProvider = omit(testProvider,
    ['globalConnectionLimit', 'protocol', 'cmKeyId']);

  const updatedProvider = {
    ...expectedProvider,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await request(app)
    .put(`/providers/${id}`)
    .send(updatedProvider)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const actualProvider = await providerModel.get({ id });
  const actualPostgresProvider = await t.context.providerPgModel.get(
    t.context.testKnex,
    { name: id }
  );
  const updatedEsRecord = await t.context.esProviderClient.get(
    testProvider.id
  );

  t.true(actualProvider.updatedAt > updatedProvider.updatedAt);
  // createdAt timestamp from original record should have been preserved
  t.is(actualProvider.createdAt, testProvider.createdAt);
  // PG and Dynamo records have the same timestamps
  t.is(actualPostgresProvider.created_at.getTime(), actualProvider.createdAt);
  t.is(actualPostgresProvider.updated_at.getTime(), actualProvider.updatedAt);
  t.is(actualPostgresProvider.created_at.getTime(), updatedEsRecord.createdAt);
  t.is(actualPostgresProvider.updated_at.getTime(), updatedEsRecord.updatedAt);
});

test('PUT returns 404 for non-existent provider', async (t) => {
  const id = randomString();
  const response = await request(app)
    .put(`/provider/${id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ id })
    .expect(404);
  const { message, record } = response.body;

  t.truthy(message);
  t.falsy(record);
});

test('PUT returns 404 for non-existent postgres provider', async (t) => {
  const id = randomString();
  const newProvider = fakeProviderFactory({ id });
  await providerModel.create(newProvider);

  const response = await request(app)
    .put(`/provider/${id}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ id })
    .expect(404);
  const { message, record } = response.body;

  t.truthy(message);
  t.falsy(record);
});

test('PUT returns 400 for id mismatch between params and payload',
  async (t) => {
    const response = await request(app)
      .put(`/providers/${randomString()}`)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send({ id: randomString() })
      .expect(400);
    const { message, record } = response.body;

    t.truthy(message);
    t.falsy(record);
  });

test('PUT without an Authorization header returns an Authorization Missing response and does not update an existing provider', async (t) => {
  const updatedLimit = t.context.testProvider.globalConnectionLimit + 1;
  const response = await request(app)
    .put(`/providers/${t.context.testProvider.id}`)
    .send({ globalConnectionLimit: updatedLimit })
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
  const provider = await providerModel.get({
    id: t.context.testProvider.id,
  });
  t.is(provider.globalConnectionLimit, t.context.testProvider.globalConnectionLimit);
});

test('put() does not write to PostgreSQL/Elasticsearch if writing to Dynamo fails', async (t) => {
  const { testKnex } = t.context;
  const {
    originalProvider,
    originalPgRecord,
    originalEsRecord,
  } = await createProviderTestRecords(
    t.context,
    {
      host: 'first-host',
    }
  );

  const fakeProvidersModel = {
    get: () => Promise.resolve(originalProvider),
    create: () => {
      throw new Error('something bad');
    },
  };

  const updatedProvider = {
    ...originalProvider,
    host: 'second-host',
  };

  const expressRequest = {
    params: {
      id: updatedProvider.id,
    },
    body: updatedProvider,
    testContext: {
      knex: testKnex,
      providerModel: fakeProvidersModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await providerModel.get({
      id: updatedProvider.id,
    }),
    originalProvider
  );
  t.deepEqual(
    await t.context.providerPgModel.get(t.context.testKnex, {
      name: updatedProvider.id,
    }),
    originalPgRecord
  );
  t.deepEqual(
    await t.context.esProviderClient.get(
      originalProvider.id
    ),
    originalEsRecord
  );
});

test('put() does not write to Dynamo/Elasticsearch if writing to PostgreSQL fails', async (t) => {
  const { testKnex } = t.context;
  const {
    originalProvider,
    originalPgRecord,
    originalEsRecord,
  } = await createProviderTestRecords(
    t.context,
    {
      host: 'first-host',
    }
  );

  const fakeproviderPgModel = {
    upsert: () => Promise.reject(new Error('something bad')),
    get: () => fakeProviderRecordFactory({ created_at: new Date() }),
  };

  const updatedProvider = {
    ...originalProvider,
    host: 'second-host',
  };

  const expressRequest = {
    params: {
      id: updatedProvider.id,
    },
    body: updatedProvider,
    testContext: {
      knex: testKnex,
      providerPgModel: fakeproviderPgModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await providerModel.get({
      id: updatedProvider.id,
    }),
    originalProvider
  );
  t.deepEqual(
    await t.context.providerPgModel.get(t.context.testKnex, {
      name: updatedProvider.id,
    }),
    originalPgRecord
  );
  t.deepEqual(
    await t.context.esProviderClient.get(
      originalProvider.id
    ),
    originalEsRecord
  );
});

test('put() does not write to Dynamo/Elasticsearch if writing to PostgreSQL fails and no dynamoDB record existed', async (t) => {
  const { testKnex } = t.context;
  const {
    originalProvider,
    originalPgRecord,
    originalEsRecord,
  } = await createProviderTestRecords(
    t.context,
    {
      host: 'first-host',
    }
  );

  await t.context.providerModel.delete(originalProvider);
  const fakeproviderPgModel = {
    upsert: () => Promise.reject(new Error('something bad')),
    get: () => fakeProviderRecordFactory({ created_at: new Date() }),
  };

  const updatedProvider = {
    ...originalProvider,
    host: 'second-host',
  };

  const expressRequest = {
    params: {
      id: updatedProvider.id,
    },
    body: updatedProvider,
    testContext: {
      knex: testKnex,
      providerPgModel: fakeproviderPgModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(expressRequest, response),
    { message: 'something bad' }
  );

  await t.throwsAsync(() =>
    providerModel.get({
      id: updatedProvider.id,
    }),
  { name: 'RecordDoesNotExist' });
  t.deepEqual(
    await t.context.providerPgModel.get(t.context.testKnex, {
      name: updatedProvider.id,
    }),
    originalPgRecord
  );
  t.deepEqual(
    await t.context.esProviderClient.get(
      originalProvider.id
    ),
    originalEsRecord
  );
});

test('put() does not write to Dynamo/PostgreSQL if writing to Elasticsearch fails', async (t) => {
  const { testKnex } = t.context;
  const {
    originalProvider,
    originalPgRecord,
    originalEsRecord,
  } = await createProviderTestRecords(
    t.context,
    {
      host: 'first-host',
    }
  );

  const fakeEsClient = {
    index: () => Promise.reject(new Error('something bad')),
  };

  const updatedProvider = {
    ...originalProvider,
    host: 'second-host',
  };

  const expressRequest = {
    params: {
      id: updatedProvider.id,
    },
    body: updatedProvider,
    testContext: {
      knex: testKnex,
      esClient: fakeEsClient,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await providerModel.get({
      id: updatedProvider.id,
    }),
    originalProvider
  );
  t.deepEqual(
    await t.context.providerPgModel.get(t.context.testKnex, {
      name: updatedProvider.id,
    }),
    originalPgRecord
  );
  t.deepEqual(
    await t.context.esProviderClient.get(
      originalProvider.id
    ),
    originalEsRecord
  );
});

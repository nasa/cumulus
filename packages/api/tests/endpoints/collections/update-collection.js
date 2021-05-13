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
} = require('@cumulus/db');
const {
  constructCollectionId,
} = require('@cumulus/message/Collections');

const models = require('../../../models');
const {
  createFakeJwtAuthToken,
  fakeCollectionFactory,
  setAuthorizedOAuthUsers,
  createCollectionTestRecords,
} = require('../../../lib/testUtils');
const EsCollection = require('../../../es/collections');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('../../../es/testUtils');
const assertions = require('../../../lib/assertions');
const { put } = require('../../../endpoints/collections');

const { buildFakeExpressResponse } = require('../utils');

process.env.AccessTokensTable = randomString();
process.env.CollectionsTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../../app');

let jwtAuthToken;
let accessTokenModel;

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

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.esCollectionClient = new EsCollection(
    {},
    undefined,
    t.context.esIndex
  );

  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  t.context.collectionModel = new models.Collection({ tableName: process.env.CollectionsTable });
  await t.context.collectionModel.createTable();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
});

test.after.always(async (t) => {
  await accessTokenModel.deleteTable();
  await t.context.collectionModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await cleanupTestIndex(t.context);
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
  const {
    originalCollection,
    originalPgRecord,
    originalEsRecord,
  } = await createCollectionTestRecords(
    t.context,
    {
      duplicateHandling: 'replace',
      process: randomString(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
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

  const actualCollection = await t.context.collectionModel.get({
    name: originalCollection.name,
    version: originalCollection.version,
  });

  const actualPgCollection = await t.context.collectionPgModel.get(t.context.testKnex, {
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

  const updatedEsRecord = await t.context.esCollectionClient.get(
    constructCollectionId(originalCollection.name, originalCollection.version)
  );
  t.like(
    updatedEsRecord,
    {
      ...originalEsRecord,
      duplicateHandling: 'error',
      process: undefined,
      createdAt: originalCollection.createdAt,
      updatedAt: actualCollection.updatedAt,
      timestamp: updatedEsRecord.timestamp,
    }
  );

  t.deepEqual(actualPgCollection, {
    ...originalPgRecord,
    duplicate_handling: 'error',
    process: null,
    created_at: originalPgRecord.created_at,
    updated_at: actualPgCollection.updated_at,
  });
});

test('PUT replaces an existing collection in all data stores with correct timestamps', async (t) => {
  const { originalCollection } = await createCollectionTestRecords(
    t.context,
    {
      duplicateHandling: 'replace',
      process: randomString(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  );

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

  const actualCollection = await t.context.collectionModel.get({
    name: originalCollection.name,
    version: originalCollection.version,
  });

  const actualPgCollection = await t.context.collectionPgModel.get(t.context.testKnex, {
    name: originalCollection.name,
    version: originalCollection.version,
  });

  const updatedEsRecord = await t.context.esCollectionClient.get(
    constructCollectionId(originalCollection.name, originalCollection.version)
  );

  // Endpoint logic will set an updated timestamp and ignore the value from the request
  // body, so value on actual records should be different (greater) than the value
  // sent in the request body
  t.true(actualCollection.updatedAt > updatedCollection.updatedAt);
  // createdAt timestamp from original record should have been preserved
  t.is(actualCollection.createdAt, originalCollection.createdAt);
  // PG and Dynamo records have the same timestamps
  t.is(actualPgCollection.created_at.getTime(), actualCollection.createdAt);
  t.is(actualPgCollection.updated_at.getTime(), actualCollection.updatedAt);
  t.is(actualPgCollection.created_at.getTime(), updatedEsRecord.createdAt);
  t.is(actualPgCollection.updated_at.getTime(), updatedEsRecord.updatedAt);
});

test('PUT creates a new record in RDS if one does not exist', async (t) => {
  const knex = t.context.testKnex;
  const originalCollection = fakeCollectionFactory({
    duplicateHandling: 'replace',
    process: randomString(),
  });

  await t.context.collectionModel.create(originalCollection);

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

  const fetchedDynamoRecord = await t.context.collectionModel.get({
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

test('put() does not write to PostgreSQL/Elasticsearch if writing to Dynamo fails', async (t) => {
  const { testKnex } = t.context;
  const {
    originalCollection,
    originalPgRecord,
    originalEsRecord,
  } = await createCollectionTestRecords(
    t.context,
    {
      duplicateHandling: 'error',
    }
  );

  const fakeCollectionsModel = {
    get: async () => originalCollection,
    create: () => {
      throw new Error('something bad');
    },
  };

  const updatedCollection = {
    ...originalCollection,
    duplicateHandling: 'replace',
  };

  const expressRequest = {
    params: {
      name: originalCollection.name,
      version: originalCollection.version,
    },
    body: updatedCollection,
    testContext: {
      knex: testKnex,
      collectionsModel: fakeCollectionsModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await t.context.collectionModel.get({
      name: updatedCollection.name,
      version: updatedCollection.version,
    }),
    originalCollection
  );
  t.deepEqual(
    await t.context.collectionPgModel.get(t.context.testKnex, {
      name: updatedCollection.name,
      version: updatedCollection.version,
    }),
    originalPgRecord
  );
  t.deepEqual(
    await t.context.esCollectionClient.get(
      constructCollectionId(originalCollection.name, originalCollection.version)
    ),
    originalEsRecord
  );
});

test('put() does not write to Dynamo/Elasticsearch if writing to PostgreSQL fails', async (t) => {
  const { testKnex } = t.context;
  const {
    originalCollection,
    originalPgRecord,
    originalEsRecord,
  } = await createCollectionTestRecords(
    t.context,
    {
      duplicateHandling: 'error',
    }
  );

  const fakeCollectionPgModel = {
    upsert: () => Promise.reject(new Error('something bad')),
  };

  const updatedCollection = {
    ...originalCollection,
    duplicateHandling: 'replace',
  };

  const expressRequest = {
    params: {
      name: originalCollection.name,
      version: originalCollection.version,
    },
    body: updatedCollection,
    testContext: {
      knex: testKnex,
      collectionPgModel: fakeCollectionPgModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await t.context.collectionModel.get({
      name: updatedCollection.name,
      version: updatedCollection.version,
    }),
    originalCollection
  );
  t.deepEqual(
    await t.context.collectionPgModel.get(t.context.testKnex, {
      name: updatedCollection.name,
      version: updatedCollection.version,
    }),
    originalPgRecord
  );
  t.deepEqual(
    await t.context.esCollectionClient.get(
      constructCollectionId(originalCollection.name, originalCollection.version)
    ),
    originalEsRecord
  );
});

test('put() does not write to Dynamo/PostgreSQL if writing to Elasticsearch fails', async (t) => {
  const { testKnex } = t.context;
  const {
    originalCollection,
    originalPgRecord,
    originalEsRecord,
  } = await createCollectionTestRecords(
    t.context,
    {
      duplicateHandling: 'error',
    }
  );

  const fakeEsClient = {
    index: () => Promise.reject(new Error('something bad')),
  };

  const updatedCollection = {
    ...originalCollection,
    duplicateHandling: 'replace',
  };

  const expressRequest = {
    params: {
      name: originalCollection.name,
      version: originalCollection.version,
    },
    body: updatedCollection,
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
    await t.context.collectionModel.get({
      name: updatedCollection.name,
      version: updatedCollection.version,
    }),
    originalCollection
  );
  t.deepEqual(
    await t.context.collectionPgModel.get(t.context.testKnex, {
      name: updatedCollection.name,
      version: updatedCollection.version,
    }),
    originalPgRecord
  );
  t.deepEqual(
    await t.context.esCollectionClient.get(
      constructCollectionId(originalCollection.name, originalCollection.version)
    ),
    originalEsRecord
  );
});

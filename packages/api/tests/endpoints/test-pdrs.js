'use strict';

const test = require('ava');
const request = require('supertest');
const cryptoRandomString = require('crypto-random-string');
const awsServices = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
  deleteS3Object,
  s3ObjectExists,
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  ExecutionPgModel,
  generateLocalTestDb,
  localStackConnectionEnv,
  migrationDir,
  PdrPgModel,
  ProviderPgModel,
  translateApiPdrToPostgresPdr,
} = require('@cumulus/db');
const {
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeProviderRecordFactory,
  fakePdrRecordFactory,
} = require('@cumulus/db/dist/test-utils');
const indexer = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');
const { constructCollectionId } = require('@cumulus/message/Collections');

const {
  createFakeJwtAuthToken,
  fakePdrFactory,
  setAuthorizedOAuthUsers,
  createPdrTestRecords,
  fakePdrFactoryV2,
} = require('../../lib/testUtils');
const models = require('../../models');
const assertions = require('../../lib/assertions');
const { del } = require('../../endpoints/pdrs');
const { buildFakeExpressResponse } = require('./utils');

process.env.AccessTokensTable = randomString();
process.env.PdrsTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../app');

const pdrS3Key = (pdrName) => `${process.env.stackName}/pdrs/${pdrName}`;

const uploadPdrToS3 = (bucket, pdrName, pdrBody) =>
  awsServices.s3().putObject({
    Bucket: bucket,
    Key: pdrS3Key(pdrName),
    Body: pdrBody,
  });

// create all the variables needed across this test
const testDbName = `pdrs_${cryptoRandomString({ length: 10 })}`;
let fakePdrs;
let jwtAuthToken;
let accessTokenModel;

test.before(async (t) => {
  const esAlias = randomString();
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    ES_INDEX: esAlias,
    PG_DATABASE: testDbName,
  };

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.esPdrsClient = new Search(
    {},
    'pdr',
    t.context.esIndex
  );

  // create a fake bucket
  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket });

  t.context.pdrModel = new models.Pdr();
  await t.context.pdrModel.createTable();

  t.context.pdrPgModel = new PdrPgModel();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  // create fake PDR records
  fakePdrs = ['completed', 'failed'].map(fakePdrFactory);
  await Promise.all(
    fakePdrs.map(
      (pdr) => t.context.pdrModel.create(pdr)
        .then((record) => indexer.indexPdr(t.context.esClient, record, t.context.esIndex))
    )
  );

  // Create a PG Collection
  t.context.testPgCollection = fakeCollectionRecordFactory();
  const collectionPgModel = new CollectionPgModel();
  const [pgCollection] = await collectionPgModel.create(
    t.context.knex,
    t.context.testPgCollection
  );
  t.context.collectionCumulusId = pgCollection.cumulus_id;

  // Create a PG Provider
  t.context.testPgProvider = fakeProviderRecordFactory();
  const providerPgModel = new ProviderPgModel();
  const [pgProvider] = await providerPgModel.create(
    t.context.knex,
    t.context.testPgProvider
  );
  t.context.providerCumulusId = pgProvider.cumulus_id;

  // Create an execution
  t.context.testPgExecution = fakeExecutionRecordFactory({
    collection_cumulus_id: t.context.testPgCollection.cumulus_id,
  });
  const executionPgModel = new ExecutionPgModel();
  const [pgExecution] = await executionPgModel.create(
    t.context.knex,
    t.context.testPgExecution
  );
  t.context.executionCumulusId = pgExecution.cumulus_id;
});

test.after.always(async (t) => {
  await accessTokenModel.deleteTable();
  await t.context.pdrModel.deleteTable();
  await cleanupTestIndex(t.context);
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/pdrs')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-911 GET with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/pdrs/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-911 DELETE with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .delete('/pdrs/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 GET without pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/pdrs')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test('CUMULUS-912 GET with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/pdrs/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 GET with an unauthorized user returns an unauthorized response');

test('CUMULUS-912 DELETE with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .delete('/pdrs/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 DELETE with pathParameters and with an unauthorized user returns an unauthorized response');

test('default returns list of pdrs', async (t) => {
  const response = await request(app)
    .get('/pdrs')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { meta, results } = response.body;
  t.is(results.length, 2);
  t.is(meta.stack, process.env.stackName);
  t.is(meta.table, 'pdr');
  t.is(meta.count, 2);
  const pdrNames = fakePdrs.map((i) => i.pdrName);
  results.forEach((r) => {
    t.true(pdrNames.includes(r.pdrName));
  });
});

test('GET returns an existing pdr', async (t) => {
  const timestamp = new Date();

  const newPGPdr = {
    status: 'completed',
    name: `${randomString()}.PDR`,
    collection_cumulus_id: t.context.collectionCumulusId,
    provider_cumulus_id: t.context.providerCumulusId,
    created_at: timestamp,
    updated_at: timestamp,
  };

  const expectedPdr = {
    status: newPGPdr.status,
    pdrName: newPGPdr.name,
    provider: t.context.testPgProvider.name,
    collectionId: constructCollectionId(
      t.context.testPgCollection.name,
      t.context.testPgCollection.version
    ),
    createdAt: timestamp.getTime(),
    updatedAt: timestamp.getTime(),
  };

  // create a new PDR in RDS
  await t.context.pdrPgModel.create(t.context.knex, newPGPdr);

  const response = await request(app)
    .get(`/pdrs/${newPGPdr.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.deepEqual(
    response.body,
    {
      ...expectedPdr,
      updatedAt: response.body.updatedAt,
      createdAt: response.body.createdAt,
    }
  );
});

test('GET fails if pdr is not found', async (t) => {
  const response = await request(app)
    .get('/pdrs/unknownpdr')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);

  t.is(response.status, 404);
  const { message } = response.body;
  t.true(message.includes('No record found for'));
});

test('DELETE returns a 404 if PostgreSQL and Elasticsearch PDR cannot be found', async (t) => {
  const nonExistentPdr = fakePdrFactory('completed');
  const response = await request(app)
    .delete(`/pdrs/${nonExistentPdr.pdrName}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);
  t.is(response.body.message, 'No record found');
});

test('Deleting a PDR that exists in PostgreSQL and not Elasticsearch succeeds', async (t) => {
  const {
    esPdrsClient,
    testPgCollection,
    testPgProvider,
    knex,
    pdrModel,
    pdrPgModel,
  } = t.context;

  const testPdr = fakePdrFactoryV2({
    collectionId: constructCollectionId(testPgCollection.name, testPgCollection.version),
    provider: testPgProvider.name,
  });

  const insertPgRecord = await translateApiPdrToPostgresPdr(testPdr, knex);
  const originalDynamoPdr = await pdrModel.create(testPdr);
  const [pgPdr] = await pdrPgModel.create(knex, insertPgRecord);
  const originalPgRecord = await pdrPgModel.get(
    knex, { cumulus_id: pgPdr.cumulus_id }
  );

  t.false(
    await esPdrsClient.exists(
      originalDynamoPdr.pdrName
    )
  );

  const response = await request(app)
    .delete(`/pdrs/${originalDynamoPdr.pdrName}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);
  const { detail } = response.body;

  t.is(detail, 'Record deleted');

  t.false(
    await t.context.pdrModel.exists({ pdrName: originalDynamoPdr.pdrName })
  );
  t.false(await pdrPgModel.exists(knex, { name: originalPgRecord.name }));
});

test.serial('Deleting a PDR that exists in Elastisearch and not PostgreSQL succeeds', async (t) => {
  const {
    esPdrsClient,
    testPgCollection,
    testPgProvider,
    knex,
    pdrModel,
    pdrPgModel,
  } = t.context;

  const testPdr = fakePdrFactoryV2({
    collectionId: constructCollectionId(testPgCollection.name, testPgCollection.version),
    provider: testPgProvider.name,
  });
  const originalDynamoPdr = await pdrModel.create(testPdr);
  await indexer.indexPdr(t.context.esClient, testPdr, t.context.esIndex);

  t.false(await pdrPgModel.exists(knex, { name: testPdr.pdrName }));

  const response = await request(app)
    .delete(`/pdrs/${originalDynamoPdr.pdrName}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);
  const { detail } = response.body;

  t.is(detail, 'Record deleted');

  t.false(
    await t.context.pdrModel.exists({
      pdrName: originalDynamoPdr.pdrName,
    })
  );
  t.false(
    await esPdrsClient.exists(
      originalDynamoPdr.pdrName
    )
  );
});

test.serial('DELETE a pdr', async (t) => {
  const {
    originalPgRecord,
  } = await createPdrTestRecords(t.context);
  // create a new pdr

  const key = `${process.env.stackName}/pdrs/${originalPgRecord.name}`;
  await awsServices.s3().putObject({ Bucket: process.env.system_bucket, Key: key, Body: 'test data' });

  const response = await request(app)
    .delete(`/pdrs/${originalPgRecord.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.status, 200);
  const { detail } = response.body;
  t.is(detail, 'Record deleted');
});

test.serial('DELETE handles the case where the PDR exists in S3 but not in DynamoDb', async (t) => {
  const {
    knex,
    pdrPgModel,
    testPgProvider,
    testPgCollection,
  } = t.context;

  const nonExistentPdr = fakePdrFactoryV2({
    collectionId: constructCollectionId(testPgCollection.name, testPgCollection.version),
    provider: testPgProvider.name,
  });
  const insertPgRecord = await translateApiPdrToPostgresPdr(nonExistentPdr, knex);
  await pdrPgModel.create(knex, insertPgRecord);

  const pdrName = insertPgRecord.name;

  await uploadPdrToS3(
    process.env.system_bucket,
    pdrName,
    'This is the PDR body'
  );

  const response = await request(app)
    .delete(`/pdrs/${pdrName}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.status, 200);

  const parsedBody = response.body;
  t.is(parsedBody.detail, 'Record deleted');
});

test.serial('DELETE handles the case where the PDR exists in DynamoDb but not in S3', async (t) => {
  const {
    originalDynamoPdr,
  } = await createPdrTestRecords(t.context);

  const response = await request(app)
    .delete(`/pdrs/${originalDynamoPdr.pdrName}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.status, 200);

  const parsedBody = response.body;
  t.is(parsedBody.detail, 'Record deleted');
});

test.serial('DELETE removes a PDR from all data stores', async (t) => {
  const {
    originalDynamoPdr,
  } = await createPdrTestRecords(t.context);

  const response = await request(app)
    .delete(`/pdrs/${originalDynamoPdr.pdrName}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);
  t.is(response.status, 200);

  // Check Dynamo and RDS. The PDR should have been removed from both.
  t.false(
    await t.context.pdrModel.exists({ pdrName: originalDynamoPdr.pdrName })
  );
  t.false(await t.context.pdrPgModel.exists(t.context.knex, { name: originalDynamoPdr.pdrName }));
  t.false(
    await t.context.esPdrsClient.exists(
      originalDynamoPdr.pdrName
    )
  );
});

test.serial('DELETE removes a PDR from RDS only if no DynamoDB record exists', async (t) => {
  const pdrName = `pdr_${cryptoRandomString({ length: 6 })}`;
  const newPGPdr = fakePdrRecordFactory({
    name: pdrName,
    status: 'completed',
    collection_cumulus_id: t.context.collectionCumulusId,
    provider_cumulus_id: t.context.providerCumulusId,
  });

  // create a new PDR in RDS
  await t.context.pdrPgModel.create(t.context.knex, newPGPdr);

  const response = await request(app)
    .delete(`/pdrs/${pdrName}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);
  t.is(response.status, 200);

  // Check Dynamo and RDS. The PDR should not exist in either.
  t.false(
    await t.context.pdrModel.exists({ pdrName })
  );
  t.false(await t.context.pdrPgModel.exists(t.context.knex, { name: pdrName }));
});

test.serial('del() does not remove from PostgreSQL/Elasticsearch/S3 if removing from Dynamo fails', async (t) => {
  const {
    originalDynamoPdr,
  } = await createPdrTestRecords(
    t.context
  );

  t.teardown(async () => {
    await t.context.pdrModel.delete({
      pdrName: originalDynamoPdr.pdrName,
    });
    await t.context.pdrPgModel.delete(t.context.knex, {
      name: originalDynamoPdr.pdrName,
    });
    await indexer.deleteRecord({
      esClient: t.context.esClient,
      id: originalDynamoPdr.pdrName,
      type: 'pdr',
      index: t.context.esIndex,
    });
    await deleteS3Object(process.env.system_bucket, pdrS3Key(originalDynamoPdr.pdrName));
  });

  const fakePdrsModel = {
    get: () => Promise.resolve(originalDynamoPdr),
    delete: () => {
      throw new Error('something bad');
    },
    create: () => Promise.resolve(true),
  };

  const expressRequest = {
    params: {
      pdrName: originalDynamoPdr.pdrName,
    },
    testContext: {
      knex: t.context.knex,
      pdrModel: fakePdrsModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    del(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await t.context.pdrModel.get({
      pdrName: originalDynamoPdr.pdrName,
    }),
    originalDynamoPdr
  );
  t.true(
    await t.context.pdrPgModel.exists(t.context.knex, {
      name: originalDynamoPdr.pdrName,
    })
  );
  t.true(
    await t.context.esPdrsClient.exists(
      originalDynamoPdr.pdrName
    )
  );
  t.true(
    await s3ObjectExists({
      Bucket: process.env.system_bucket,
      Key: pdrS3Key(originalDynamoPdr.pdrName),
    })
  );
});

test.serial('del() does not remove from Dynamo/Elasticsearch/S3 if removing from PostgreSQL fails', async (t) => {
  const {
    originalDynamoPdr,
    originalPgRecord,
  } = await createPdrTestRecords(
    t.context
  );

  t.teardown(async () => {
    await t.context.pdrModel.delete({
      pdrName: originalDynamoPdr.pdrName,
    });
    await t.context.pdrPgModel.delete(t.context.knex, {
      name: originalDynamoPdr.pdrName,
    });
    await indexer.deleteRecord({
      esClient: t.context.esClient,
      id: originalDynamoPdr.pdrName,
      type: 'pdr',
      index: t.context.esIndex,
    });
    await deleteS3Object(process.env.system_bucket, pdrS3Key(originalDynamoPdr.pdrName));
  });

  const fakePdrPgModel = {
    delete: () => {
      throw new Error('something bad');
    },
    get: () => Promise.resolve(originalPgRecord),
  };

  const expressRequest = {
    params: {
      pdrName: originalDynamoPdr.pdrName,
    },
    testContext: {
      knex: t.context.knex,
      pdrPgModel: fakePdrPgModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    del(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await t.context.pdrModel.get({
      pdrName: originalDynamoPdr.pdrName,
    }),
    originalDynamoPdr
  );
  t.true(
    await t.context.pdrPgModel.exists(t.context.knex, {
      name: originalDynamoPdr.pdrName,
    })
  );
  t.true(
    await t.context.esPdrsClient.exists(
      originalDynamoPdr.pdrName
    )
  );
  t.true(
    await s3ObjectExists({
      Bucket: process.env.system_bucket,
      Key: pdrS3Key(originalDynamoPdr.pdrName),
    })
  );
});

test.serial('del() does not remove from Dynamo/PostgreSQL/S3 if removing from Elasticsearch fails', async (t) => {
  const {
    originalDynamoPdr,
  } = await createPdrTestRecords(
    t.context
  );

  t.teardown(async () => {
    await t.context.pdrModel.delete({
      pdrName: originalDynamoPdr.pdrName,
    });
    await t.context.pdrPgModel.delete(t.context.knex, {
      name: originalDynamoPdr.pdrName,
    });
    await indexer.deleteRecord({
      esClient: t.context.esClient,
      id: originalDynamoPdr.pdrName,
      type: 'pdr',
      index: t.context.esIndex,
    });
    await deleteS3Object(process.env.system_bucket, pdrS3Key(originalDynamoPdr.pdrName));
  });

  const fakeEsClient = {
    delete: () => {
      throw new Error('something bad');
    },
  };

  const expressRequest = {
    params: {
      pdrName: originalDynamoPdr.pdrName,
    },
    testContext: {
      knex: t.context.knex,
      esClient: fakeEsClient,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    del(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await t.context.pdrModel.get({
      pdrName: originalDynamoPdr.pdrName,
    }),
    originalDynamoPdr
  );
  t.true(
    await t.context.pdrPgModel.exists(t.context.knex, {
      name: originalDynamoPdr.pdrName,
    })
  );
  t.true(
    await t.context.esPdrsClient.exists(
      originalDynamoPdr.pdrName
    )
  );
  t.true(
    await s3ObjectExists({
      Bucket: process.env.system_bucket,
      Key: pdrS3Key(originalDynamoPdr.pdrName),
    })
  );
});

test.serial('del() does not remove from Dynamo/PostgreSQL/Elasticsearch if removing from S3 fails', async (t) => {
  const {
    originalDynamoPdr,
  } = await createPdrTestRecords(
    t.context
  );

  t.teardown(async () => {
    await t.context.pdrModel.delete({
      pdrName: originalDynamoPdr.pdrName,
    });
    await t.context.pdrPgModel.delete(t.context.knex, {
      name: originalDynamoPdr.pdrName,
    });
    await indexer.deleteRecord({
      esClient: t.context.esClient,
      id: originalDynamoPdr.pdrName,
      type: 'pdr',
      index: t.context.esIndex,
    });
    await deleteS3Object(process.env.system_bucket, pdrS3Key(originalDynamoPdr.pdrName));
  });

  const fakeS3Utils = {
    deleteS3Object: () => {
      throw new Error('something bad');
    },
  };

  const expressRequest = {
    params: {
      pdrName: originalDynamoPdr.pdrName,
    },
    testContext: {
      knex: t.context.knex,
      s3Utils: fakeS3Utils,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    del(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await t.context.pdrModel.get({
      pdrName: originalDynamoPdr.pdrName,
    }),
    originalDynamoPdr
  );
  t.true(
    await t.context.pdrPgModel.exists(t.context.knex, {
      name: originalDynamoPdr.pdrName,
    })
  );
  t.true(
    await t.context.esPdrsClient.exists(
      originalDynamoPdr.pdrName
    )
  );
  t.true(
    await s3ObjectExists({
      Bucket: process.env.system_bucket,
      Key: pdrS3Key(originalDynamoPdr.pdrName),
    })
  );
});

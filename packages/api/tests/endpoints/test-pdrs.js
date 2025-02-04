'use strict';

const test = require('ava');
const request = require('supertest');
const cryptoRandomString = require('crypto-random-string');
const range = require('lodash/range');
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
} = require('@cumulus/db');
const {
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakePdrRecordFactory,
  fakeProviderRecordFactory,
} = require('@cumulus/db/dist/test-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');

const {
  createFakeJwtAuthToken,
  fakePdrFactory,
  setAuthorizedOAuthUsers,
  createPdrTestRecords,
} = require('../../lib/testUtils');
const models = require('../../models');
const assertions = require('../../lib/assertions');
const { del } = require('../../endpoints/pdrs');
const { buildFakeExpressResponse } = require('./utils');

process.env.AccessTokensTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../app');

const pdrS3Key = (pdrName) => `${process.env.stackName}/pdrs/${pdrName}`;

// create all the variables needed across this test
const testDbName = `pdrs_${cryptoRandomString({ length: 10 })}`;
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

  // create a fake bucket
  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket });

  t.context.pdrPgModel = new PdrPgModel();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

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
  const timestamp = new Date();
  t.context.pdrs = range(2).map(() => fakePdrRecordFactory({
    collection_cumulus_id: t.context.collectionCumulusId,
    provider_cumulus_id: t.context.providerCumulusId,
    execution_cumulus_id: t.context.executionCumulusId,
    progress: 0.5,
    pan_sent: false,
    pan_message: `pan${cryptoRandomString({ length: 10 })}`,
    stats: {
      processing: 0,
      completed: 0,
      failed: 0,
      total: 0,
    },
    address: `address${cryptoRandomString({ length: 10 })}`,
    original_url: 'https://example.com',
    duration: 6.8,
    created_at: timestamp,
    updated_at: timestamp,
  }));

  t.context.pdrPgModel = new PdrPgModel();
  t.context.pgPdrs = await t.context.pdrPgModel.insert(
    knex,
    t.context.pdrs
  );
});

test.after.always(async (t) => {
  await accessTokenModel.deleteTable();
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

test.serial('default returns list of pdrs', async (t) => {
  const response = await request(app)
    .get('/pdrs')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { meta, results } = response.body;
  t.is(results.length, 2);
  t.is(meta.stack, process.env.stackName);
  t.is(meta.table, 'pdrs');
  t.is(meta.count, 2);
  const pdrNames = t.context.pdrs.map((i) => i.name);
  results.forEach((r) => {
    t.true(pdrNames.includes(r.pdrName));
  });
});

test.serial('GET returns an existing pdr', async (t) => {
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

test('DELETE returns a 404 if PostgreSQL PDR cannot be found', async (t) => {
  const nonExistentPdr = fakePdrFactory('completed');
  const response = await request(app)
    .delete(`/pdrs/${nonExistentPdr.pdrName}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);
  t.is(response.body.message, 'No record found');
});

test.serial('Deleting a PDR that exists in PostgreSQL succeeds', async (t) => {
  const {
    collectionCumulusId,
    providerCumulusId,
    knex,
    pdrPgModel,
  } = t.context;

  const insertPgRecord = fakePdrRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    provider_cumulus_id: providerCumulusId,
  });

  const [pgPdr] = await pdrPgModel.create(knex, insertPgRecord);
  const originalPgRecord = await pdrPgModel.get(
    knex, { cumulus_id: pgPdr.cumulus_id }
  );

  const response = await request(app)
    .delete(`/pdrs/${originalPgRecord.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);
  const { detail } = response.body;

  t.is(detail, 'Record deleted');
  t.false(await pdrPgModel.exists(knex, { name: originalPgRecord.name }));
});

test.serial('DELETE handles the case where the PDR exists in PostgreSQL but not in S3', async (t) => {
  const {
    knex,
    pdrPgModel,
    collectionCumulusId,
    providerCumulusId,
  } = t.context;

  const insertPgRecord = fakePdrRecordFactory({
    collection_cumulus_id: collectionCumulusId,
    provider_cumulus_id: providerCumulusId,
  });

  const [pdr] = await pdrPgModel.create(knex, insertPgRecord);
  const originalPgRecord = await pdrPgModel.get(
    knex, { cumulus_id: pdr.cumulus_id }
  );
  const response = await request(app)
    .delete(`/pdrs/${originalPgRecord.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.status, 200);
  const parsedBody = response.body;
  t.is(parsedBody.detail, 'Record deleted');
  t.false(await pdrPgModel.exists(knex, { name: originalPgRecord.name }));
});

test.serial('DELETE removes a PDR from data store', async (t) => {
  const {
    originalPgRecord,
  } = await createPdrTestRecords(t.context);

  const response = await request(app)
    .delete(`/pdrs/${originalPgRecord.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);
  t.is(response.status, 200);
  const { detail } = response.body;
  t.is(detail, 'Record deleted');

  t.false(await t.context.pdrPgModel.exists(t.context.knex, { name: originalPgRecord.name }));
  t.false(
    await s3ObjectExists({
      Bucket: process.env.system_bucket,
      Key: pdrS3Key(originalPgRecord.name),
    })
  );
});

test.serial('del() does not remove from S3 if removing from PostgreSQL fails', async (t) => {
  const {
    originalPgRecord,
  } = await createPdrTestRecords(
    t.context
  );

  t.teardown(async () => {
    await t.context.pdrPgModel.delete(t.context.knex, {
      name: originalPgRecord.name,
    });
    await deleteS3Object(process.env.system_bucket, pdrS3Key(originalPgRecord.name));
  });

  const fakePdrPgModel = {
    delete: () => {
      throw new Error('something bad');
    },
    get: () => Promise.resolve(originalPgRecord),
  };

  const expressRequest = {
    params: {
      pdrName: originalPgRecord.name,
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

  t.true(
    await t.context.pdrPgModel.exists(t.context.knex, {
      name: originalPgRecord.name,
    })
  );
  t.true(
    await s3ObjectExists({
      Bucket: process.env.system_bucket,
      Key: pdrS3Key(originalPgRecord.name),
    })
  );
});

test.serial('del() does not remove from PostgreSQL if removing from S3 fails', async (t) => {
  const {
    originalPgRecord,
  } = await createPdrTestRecords(
    t.context
  );

  t.teardown(async () => {
    await t.context.pdrPgModel.delete(t.context.knex, {
      name: originalPgRecord.name,
    });
    await deleteS3Object(process.env.system_bucket, pdrS3Key(originalPgRecord.name));
  });

  const fakeS3Utils = {
    deleteS3Object: () => {
      throw new Error('something bad');
    },
  };

  const expressRequest = {
    params: {
      pdrName: originalPgRecord.name,
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

  t.true(
    await t.context.pdrPgModel.exists(t.context.knex, {
      name: originalPgRecord.name,
    })
  );
  t.true(
    await s3ObjectExists({
      Bucket: process.env.system_bucket,
      Key: pdrS3Key(originalPgRecord.name),
    })
  );
});

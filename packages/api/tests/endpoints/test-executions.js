'use strict';

const test = require('ava');
const request = require('supertest');
const cryptoRandomString = require('crypto-random-string');

const awsServices = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const {
  AsyncOperationPgModel,
  CollectionPgModel,
  destroyLocalTestDb,
  ExecutionPgModel,
  fakeAsyncOperationRecordFactory,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  generateLocalTestDb,
  localStackConnectionEnv,
  translatePostgresExecutionToApiExecution,
} = require('@cumulus/db');
const indexer = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');
const { constructCollectionId } = require('@cumulus/message/Collections');

const models = require('../../models');
const {
  createFakeJwtAuthToken,
  fakeExecutionFactory,
  setAuthorizedOAuthUsers,
  createExecutionTestRecords,
  cleanupExecutionTestRecords,
} = require('../../lib/testUtils');
const assertions = require('../../lib/assertions');
const { migrationDir } = require('../../../../lambdas/db-migration');

process.env.AccessTokensTable = randomString();
process.env.ExecutionsTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { del } = require('../../endpoints/executions');
const { app } = require('../../app');
const { buildFakeExpressResponse } = require('./utils');

// create all the variables needed across this test
const testDbName = `test_executions_${cryptoRandomString({ length: 10 })}`;
const fakeExecutions = [];
let jwtAuthToken;
let accessTokenModel;
let executionModel;

test.before(async (t) => {
  // create a fake bucket
  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  // create fake execution table
  executionModel = new models.Execution();
  await executionModel.createTable();
  t.context.executionModel = executionModel;

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  t.context.executionPgModel = new ExecutionPgModel();

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.esExecutionsClient = new Search(
    {},
    'execution',
    process.env.ES_INDEX
  );

  // create fake execution records
  fakeExecutions.push(fakeExecutionFactory('completed'));
  fakeExecutions.push(fakeExecutionFactory('failed', 'workflow2'));
  // TODO - this needs updated after postgres->ES work
  await Promise.all(fakeExecutions.map((i) => executionModel.create(i)
    .then((record) => indexer.indexExecution(esClient, record, process.env.ES_INDEX))));
});

test.after.always(async (t) => {
  await accessTokenModel.deleteTable();
  await executionModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
  await cleanupTestIndex(t.context);
});

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/executions')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-911 GET with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/executions/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 GET without pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/executions')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 GET with pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/executions/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('default returns list of executions', async (t) => {
  const response = await request(app)
    .get('/executions')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { meta, results } = response.body;
  t.is(results.length, 2);
  t.is(meta.stack, process.env.stackName);
  t.is(meta.table, 'execution');
  t.is(meta.count, 2);
  const arns = fakeExecutions.map((i) => i.arn);
  results.forEach((r) => {
    t.true(arns.includes(r.arn));
  });
});

test('executions can be filtered by workflow', async (t) => {
  const response = await request(app)
    .get('/executions')
    .query({ type: 'workflow2' })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { meta, results } = response.body;
  t.is(results.length, 1);
  t.is(meta.stack, process.env.stackName);
  t.is(meta.table, 'execution');
  t.is(meta.count, 1);
  t.is(fakeExecutions[1].arn, results[0].arn);
});

test('GET returns an existing execution', async (t) => {
  const collectionRecord = fakeCollectionRecordFactory();
  const asyncRecord = fakeAsyncOperationRecordFactory();
  const parentExecutionRecord = fakeExecutionRecordFactory();

  const collectionPgModel = new CollectionPgModel();
  const asyncOperationsPgModel = new AsyncOperationPgModel();

  const [collectionCumulusId] = await collectionPgModel.create(
    t.context.knex,
    collectionRecord
  );

  const [asyncOperationCumulusId] = await asyncOperationsPgModel.create(
    t.context.knex,
    asyncRecord
  );

  const [parentExecutionCumulusId] = await t.context.executionPgModel.create(
    t.context.knex,
    parentExecutionRecord
  );

  const executionRecord = await fakeExecutionRecordFactory({
    async_operation_cumulus_id: asyncOperationCumulusId,
    collection_cumulus_id: collectionCumulusId,
    parent_cumulus_id: parentExecutionCumulusId,
  });

  await t.context.executionPgModel.create(
    t.context.knex,
    executionRecord
  );
  t.teardown(async () => {
    await t.context.executionPgModel.delete(t.context.knex, executionRecord);
    await t.context.executionPgModel.delete(t.context.knex, parentExecutionRecord);
    await collectionPgModel.delete(t.context.knex, collectionRecord);
    await asyncOperationsPgModel.delete(t.context.knex, asyncRecord);
  });

  const response = await request(app)
    .get(`/executions/${executionRecord.arn}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const executionResult = response.body;
  const expectedRecord = await translatePostgresExecutionToApiExecution(
    executionRecord,
    t.context.knex
  );

  t.is(executionResult.arn, executionRecord.arn);
  t.is(executionResult.asyncOperationId, asyncRecord.id);
  t.is(executionResult.collectionId, constructCollectionId(
    collectionRecord.name,
    collectionRecord.version
  ));
  t.is(executionResult.parentArn, parentExecutionRecord.arn);
  t.like(executionResult, expectedRecord);
});

test('GET returns an existing execution without any foreign keys', async (t) => {
  const executionPgModel = new ExecutionPgModel();
  const executionRecord = await fakeExecutionRecordFactory();
  await executionPgModel.create(
    t.context.knex,
    executionRecord
  );
  t.teardown(async () => await executionPgModel.delete(
    t.context.knex,
    { arn: executionRecord.arn }
  ));
  const response = await request(app)
    .get(`/executions/${executionRecord.arn}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const executionResult = response.body;
  const expectedRecord = await translatePostgresExecutionToApiExecution(executionRecord);
  t.deepEqual(executionResult, expectedRecord);
});

test('GET fails if execution is not found', async (t) => {
  const response = await request(app)
    .get('/executions/unknown')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);
  t.is(response.status, 404);
  t.true(response.body.message.includes(`Execution record with identifiers ${JSON.stringify({ arn: 'unknown' })} does not exist`));
});

test.serial('DELETE deletes an execution', async (t) => {
  const { originalDynamoExecution } = await createExecutionTestRecords(
    t.context,
    { parentArn: undefined }
  );
  const { arn } = originalDynamoExecution;

  t.true(
    await t.context.executionModel.exists(
      { arn }
    )
  );
  t.true(
    await t.context.executionPgModel.exists(
      t.context.knex,
      { arn }
    )
  );
  t.true(
    await t.context.esExecutionsClient.exists(
      arn
    )
  );

  const response = await request(app)
    .delete(`/executions/${arn}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { message } = response.body;

  t.is(message, 'Record deleted');
  t.false(
    await t.context.executionModel.exists(
      { arn }
    )
  );
  const dbRecords = await t.context.executionPgModel
    .search(t.context.knex, { arn });
  t.is(dbRecords.length, 0);
  t.false(
    await t.context.esExecutionsClient.exists(
      arn
    )
  );
});

test.serial.only('del() does not remove from PostgreSQL/Elasticsearch if removing from Dynamo fails', async (t) => {
  const {
    originalDynamoExecution,
  } = await createExecutionTestRecords(
    t.context,
    { parentArn: undefined }
  );
  const { arn } = originalDynamoExecution;
  t.teardown(async () => await cleanupExecutionTestRecords(t.context, { arn }));

  const fakeExecutionModel = {
    get: () => Promise.resolve(originalDynamoExecution),
    delete: () => {
      throw new Error('something bad');
    },
    create: () => Promise.resolve(true),
  };

  const expressRequest = {
    params: {
      arn,
    },
    testContext: {
      knex: t.context.testKnex,
      executionModel: fakeExecutionModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    del(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await t.context.executionModel.get({
      arn,
    }),
    originalDynamoExecution
  );
  t.true(
    await t.context.executionPgModel.exists(t.context.testKnex, {
      arn,
    })
  );
  t.true(
    await t.context.esExecutionsClient.exists(
      arn
    )
  );
});

test.serial('del() does not remove from Dynamo/Elasticsearch if removing from PostgreSQL fails', async (t) => {
  const {
    originalDynamoExecution,
  } = await createExecutionTestRecords(
    t.context,
    { parentArn: undefined }
  );

  const fakeExecutionPgModel = {
    delete: () => {
      throw new Error('something bad');
    },
  };

  const expressRequest = {
    params: {
      arn: originalDynamoExecution.arn,
    },
    testContext: {
      knex: t.context.testKnex,
      executionPgModel: fakeExecutionPgModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    del(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await t.context.executionModel.get({
      arn: originalDynamoExecution.arn,
    }),
    originalDynamoExecution
  );
  t.true(
    await t.context.executionPgModel.exists(t.context.testKnex, {
      arn: originalDynamoExecution.arn,
    })
  );
  t.true(
    await t.context.esExecutionsClient.exists(
      originalDynamoExecution.arn
    )
  );
});

test.serial('del() does not remove from Dynamo/PostgreSQL if removing from Elasticsearch fails', async (t) => {
  const {
    originalDynamoExecution,
  } = await createExecutionTestRecords(
    t.context,
    { parentArn: undefined }
  );

  const fakeEsClient = {
    delete: () => {
      throw new Error('something bad');
    },
  };

  const expressRequest = {
    params: {
      arn: originalDynamoExecution.arn,
    },
    testContext: {
      knex: t.context.testKnex,
      esClient: fakeEsClient,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    del(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await t.context.executionModel.get({
      arn: originalDynamoExecution.arn,
    }),
    originalDynamoExecution
  );
  t.true(
    await t.context.executionPgModel.exists(t.context.testKnex, {
      arn: originalDynamoExecution.arn,
    })
  );
  t.true(
    await t.context.esExecutionsClient.exists(
      originalDynamoExecution.arn
    )
  );
});

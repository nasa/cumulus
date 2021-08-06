'use strict';

const test = require('ava');
const omit = require('lodash/omit');
const sortBy = require('lodash/sortBy');
const request = require('supertest');
const cryptoRandomString = require('crypto-random-string');

const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const {
  AsyncOperationPgModel,
  CollectionPgModel,
  destroyLocalTestDb,
  ExecutionPgModel,
  fakeCollectionRecordFactory,
  generateLocalTestDb,
  localStackConnectionEnv,
  translateApiExecutionToPostgresExecution,
  translatePostgresExecutionToApiExecution,
  upsertGranuleWithExecutionJoinRecord,
  fakeAsyncOperationRecordFactory,
  fakeExecutionRecordFactory,
} = require('@cumulus/db');
const indexer = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { migrationDir } = require('../../../../lambdas/db-migration');
const models = require('../../models');
const {
  createFakeJwtAuthToken,
  fakeExecutionFactoryV2,
  setAuthorizedOAuthUsers,
  createExecutionTestRecords,
  cleanupExecutionTestRecords,
  fakeExecutionFactory,
} = require('../../lib/testUtils');
const assertions = require('../../lib/assertions');

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
  await createBucket(process.env.system_bucket);

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

test.serial('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/executions')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test.serial('CUMULUS-911 GET with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/executions/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test.serial('CUMULUS-912 GET without pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/executions')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test.serial('CUMULUS-912 GET with pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/executions/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test.serial('default returns list of executions', async (t) => {
  const response = await request(app)
    .get('/executions')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { meta, results } = response.body;
  t.is(results.length, 3);
  t.is(meta.stack, process.env.stackName);
  t.is(meta.table, 'execution');
  t.is(meta.count, 3);
  const arns = fakeExecutions.map((i) => i.arn);
  results.forEach((r) => {
    t.true(arns.includes(r.arn));
  });
});

test.serial('executions can be filtered by workflow', async (t) => {
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

test.serial('GET fails if execution is not found', async (t) => {
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

test.serial('del() does not remove from PostgreSQL/Elasticsearch if removing from Dynamo fails', async (t) => {
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
      knex: t.context.knex,
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
    omit(originalDynamoExecution, 'parentArn')
  );
  t.true(
    await t.context.executionPgModel.exists(t.context.knex, {
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
  const { arn } = originalDynamoExecution;
  t.teardown(async () => await cleanupExecutionTestRecords(t.context, { arn }));

  const fakeExecutionPgModel = {
    delete: () => {
      throw new Error('something bad');
    },
  };

  const expressRequest = {
    params: {
      arn,
    },
    testContext: {
      knex: t.context.knex,
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
      arn,
    }),
    omit(originalDynamoExecution, 'parentArn')
  );
  t.true(
    await t.context.executionPgModel.exists(t.context.knex, {
      arn,
    })
  );
  t.true(
    await t.context.esExecutionsClient.exists(
      arn
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
  const { arn } = originalDynamoExecution;
  t.teardown(async () => await cleanupExecutionTestRecords(t.context, { arn }));

  const fakeEsClient = {
    delete: () => {
      throw new Error('something bad');
    },
  };

  const expressRequest = {
    params: {
      arn,
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
    await t.context.executionModel.get({
      arn,
    }),
    omit(originalDynamoExecution, 'parentArn')
  );
  t.true(
    await t.context.executionPgModel.exists(t.context.knex, {
      arn,
    })
  );
  t.true(
    await t.context.esExecutionsClient.exists(
      arn
    )
  );
});

test.serial('DELETE removes only specified execution from all data stores', async (t) => {
  const { knex, executionPgModel } = t.context;

  const newExecution = fakeExecutionFactoryV2({
    arn: 'arn3',
    status: 'completed',
    name: 'test_execution',
  });

  await executionModel.create(newExecution);
  const executionPgRecord = await translateApiExecutionToPostgresExecution(
    newExecution,
    knex
  );
  await executionPgModel.create(knex, executionPgRecord);

  t.true(await executionModel.exists({ arn: newExecution.arn }));
  t.true(await executionPgModel.exists(knex, { arn: newExecution.arn }));

  await request(app)
    .delete(`/executions/${newExecution.arn}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  // Correct Dynamo and PG execution was deleted
  t.false(await executionModel.exists({ arn: newExecution.arn }));

  const dbRecords = await executionPgModel.search(t.context.knex, {
    arn: newExecution.arn,
  });

  t.is(dbRecords.length, 0);

  // Previously created executions still exist
  t.true(await executionModel.exists({ arn: fakeExecutions[0].arn }));
  t.true(await executionModel.exists({ arn: fakeExecutions[1].arn }));

  const originalExecution1 = await executionPgModel.search(t.context.knex, {
    arn: fakeExecutions[0].arn,
  });

  t.is(originalExecution1.length, 1);

  const originalExecution2 = await executionPgModel.search(t.context.knex, {
    arn: fakeExecutions[1].arn,
  });

  t.is(originalExecution2.length, 1);
});

test.serial('DELETE returns a 404 if Dynamo execution cannot be found', async (t) => {
  const nonExistantExecution = {
    arn: 'arn9',
    status: 'completed',
    name: 'test_execution',
  };

  const response = await request(app)
    .delete(`/executions/${nonExistantExecution.arn}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);

  t.is(response.body.message, 'No record found');
});

test.serial('POST /executions/search-by-granules returns 1 record by default', async (t) => {
  const { fakeGranules, fakePGExecutions } = t.context;

  const response = await request(app)
    .post('/executions/search-by-granules')
    .send({ granules: [
      { granuleId: fakeGranules[0].granuleId, collectionId: t.context.collectionId },
      { granuleId: fakeGranules[1].granuleId, collectionId: t.context.collectionId },
    ] })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);

  t.is(response.body.results.length, 1);

  response.body.results.forEach(async (execution) => t.deepEqual(
    execution,
    await translatePostgresExecutionToApiExecution(fakePGExecutions
      .find((fakePGExecution) => fakePGExecution.arn === execution.arn))
  ));
});

test.serial('POST /executions/search-by-granules supports paging', async (t) => {
  const { fakeGranules, fakeApiExecutions } = t.context;

  const page1 = await request(app)
    .post('/executions/search-by-granules?limit=2&page=1')
    .send({ granules: [
      { granuleId: fakeGranules[0].granuleId, collectionId: t.context.collectionId },
      { granuleId: fakeGranules[1].granuleId, collectionId: t.context.collectionId },
    ] })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);

  const page2 = await request(app)
    .post('/executions/search-by-granules?limit=2&page=2')
    .send({ granules: [
      { granuleId: fakeGranules[0].granuleId, collectionId: t.context.collectionId },
      { granuleId: fakeGranules[1].granuleId, collectionId: t.context.collectionId },
    ] })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);

  t.is(page1.body.results.length, 2);
  t.is(page2.body.results.length, 1);

  const response = page1.body.results.concat(page2.body.results);

  response.forEach((execution) => t.deepEqual(
    execution,
    fakeApiExecutions.find((fakeAPIExecution) => fakeAPIExecution.arn === execution.arn)
  ));
});

test.serial('POST /executions/search-by-granules supports sorting', async (t) => {
  const { fakeGranules, fakeApiExecutions } = t.context;

  const response = await request(app)
    .post('/executions/search-by-granules?sort_by=arn&order=asc&limit=10')
    .send({ granules: [
      { granuleId: fakeGranules[0].granuleId, collectionId: t.context.collectionId },
      { granuleId: fakeGranules[1].granuleId, collectionId: t.context.collectionId },
    ] })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);

  const sortedApiExecutions = sortBy(fakeApiExecutions, ['arn']);

  t.deepEqual(response.body.results, sortedApiExecutions);
});

test.serial('POST /executions/search-by-granules returns correct executions when granules array is passed', async (t) => {
  const { fakeGranules, fakePGExecutions } = t.context;

  const response = await request(app)
    .post('/executions/search-by-granules?limit=10')
    .send({ granules: [
      { granuleId: fakeGranules[0].granuleId, collectionId: t.context.collectionId },
      { granuleId: fakeGranules[1].granuleId, collectionId: t.context.collectionId },
    ] })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);

  t.is(response.body.results.length, 3);

  response.body.results.forEach(async (execution) => t.deepEqual(
    execution,
    await translatePostgresExecutionToApiExecution(fakePGExecutions
      .find((fakePGExecution) => fakePGExecution.arn === execution.arn))
  ));
});

test.serial('POST /executions/search-by-granules returns correct executions when query is passed', async (t) => {
  const { fakeGranules, fakePGExecutions, esIndex } = t.context;

  const expectedQuery = {
    size: 2,
    query: {
      bool: {
        filter: [
          {
            bool: {
              should: [{ match: { granuleId: fakeGranules[0].granuleId } }],
              minimum_should_match: 1,
            },
          },
          {
            bool: {
              should: [{ match: { collectionId: fakeGranules[0].collectionId } }],
              minimum_should_match: 1,
            },
          },
        ],
      },
    },
  };

  const body = {
    index: esIndex,
    query: expectedQuery,
  };

  const response = await request(app)
    .post('/executions/search-by-granules?limit=10')
    .send(body)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);

  t.is(response.body.results.length, 2);

  response.body.results.forEach(async (execution) => t.deepEqual(
    execution,
    await translatePostgresExecutionToApiExecution(fakePGExecutions
      .find((fakePGExecution) => fakePGExecution.arn === execution.arn))
  ));
});

test.serial('POST /executions/search-by-granules returns 400 when a query is provided with no index', async (t) => {
  const expectedQuery = { query: 'fake-query' };

  const body = {
    query: expectedQuery,
  };

  const response = await request(app)
    .post('/executions/search-by-granules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400);

  t.regex(response.body.message, /Index is required if query is sent/);
});

test.serial('POST /executions/search-by-granules returns 400 when no granules or query is provided', async (t) => {
  const expectedIndex = 'my-index';

  const body = {
    index: expectedIndex,
  };

  const response = await request(app)
    .post('/executions/search-by-granules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /One of granules or query is required/);

  t.regex(response.body.message, /One of granules or query is required/);
});

test.serial('POST /executions/search-by-granules returns 400 when granules is not an array', async (t) => {
  const expectedIndex = 'my-index';

  const body = {
    index: expectedIndex,
    granules: 'bad-value',
  };

  const response = await request(app)
    .post('/executions/search-by-granules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400);

  t.regex(response.body.message, /granules should be an array of values/);
});

test.serial('POST /executions/search-by-granules returns 400 when granules is an empty array', async (t) => {
  const expectedIndex = 'my-index';

  const body = {
    index: expectedIndex,
    granules: [],
  };

  const response = await request(app)
    .post('/executions/search-by-granules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400);

  t.regex(response.body.message, /no values provided for granules/);
});

test.serial('POST /executions/search-by-granules returns 400 when granules do not have collectionId', async (t) => {
  const expectedIndex = 'my-index';
  const granule = { granuleId: randomId('granuleId') };

  const body = {
    index: expectedIndex,
    granules: [granule],
  };

  const response = await request(app)
    .post('/executions/search-by-granules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400);

  t.regex(response.body.message, new RegExp(`no collectionId provided for ${JSON.stringify(granule)}`));
});

test.serial('POST /executions/search-by-granules returns 400 when granules do not have granuleId', async (t) => {
  const expectedIndex = 'my-index';
  const granule = { collectionId: randomId('granuleId') };

  const body = {
    index: expectedIndex,
    granules: [granule],
  };

  const response = await request(app)
    .post('/executions/search-by-granules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400);

  t.regex(response.body.message, new RegExp(`no granuleId provided for ${JSON.stringify(granule)}`));
});

test.serial('POST /executions/search-by-granules returns 400 when the Metrics ELK stack is not configured', async (t) => {
  const expectedIndex = 'my-index';
  const expectedQuery = { query: 'fake-query' };

  const body = {
    index: expectedIndex,
    query: expectedQuery,
  };

  const metricsUser = process.env.METRICS_ES_USER;
  delete process.env.METRICS_ES_USER;
  t.teardown(() => {
    process.env.METRICS_ES_USER = metricsUser;
  });

  const response = await request(app)
    .post('/executions/search-by-granules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400);

  t.regex(response.body.message, /ELK Metrics stack not configured/);
});

test.serial('POST /executions/workflows-by-granules returns correct executions when granules array is passed', async (t) => {
  const { collectionId, fakeGranules, fakePGExecutions } = t.context;

  const response = await request(app)
    .post('/executions/workflows-by-granules')
    .send({ granules: [
      { granuleId: fakeGranules[0].granuleId, collectionId },
      { granuleId: fakeGranules[1].granuleId, collectionId },
    ] })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);

  t.is(response.body.length, 1);

  response.body.forEach((workflow) => t.deepEqual(
    workflow,
    fakePGExecutions
      .map((fakePGExecution) => fakePGExecution.workflow_name)
      .find((workflowName) => workflowName === workflow)
  ));
});

test.serial('POST /executions/workflows-by-granules returns executions by descending timestamp when a single granule is passed', async (t) => {
  const {
    knex,
    collectionId,
    executionPgModel,
    fakeGranules,
    fakePGGranules,
  } = t.context;

  const [mostRecentExecutionCumulusId]
    = await executionPgModel.create(knex, fakeExecutionRecordFactory({ workflow_name: 'newWorkflow' }));

  await upsertGranuleWithExecutionJoinRecord(
    knex, fakePGGranules[0], mostRecentExecutionCumulusId
  );

  const response = await request(app)
    .post('/executions/workflows-by-granules')
    .send({ granules: [
      { granuleId: fakeGranules[0].granuleId, collectionId },
    ] })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);

  t.is(response.body.length, 3);
  // newWorkflow should be the first result since it is most recent
  t.is(response.body[0], 'newWorkflow');
});

test.serial('POST /executions/workflows-by-granules returns correct workflows when query is passed', async (t) => {
  const { esIndex, fakeGranules } = t.context;

  const expectedQuery = {
    size: 2,
    query: {
      bool: {
        filter: [
          {
            bool: {
              should: [{ match: { granuleId: fakeGranules[0].granuleId } }],
              minimum_should_match: 1,
            },
          },
          {
            bool: {
              should: [{ match: { collectionId: fakeGranules[0].collectionId } }],
              minimum_should_match: 1,
            },
          },
        ],
      },
    },
  };

  const body = {
    index: esIndex,
    query: expectedQuery,
  };

  const response = await request(app)
    .post('/executions/workflows-by-granules')
    .send(body)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);

  t.is(response.body.length, 2);

  t.deepEqual(response.body.sort(), ['fakeWorkflow', 'workflow2']);
});

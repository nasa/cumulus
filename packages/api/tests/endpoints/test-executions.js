'use strict';

const test = require('ava');
const request = require('supertest');
const cryptoRandomString = require('crypto-random-string');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
  s3PutObject,
} = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  ExecutionPgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeGranuleRecordFactory,
  generateLocalTestDb,
  GranulePgModel,
  GranulesExecutionsPgModel,
  localStackConnectionEnv,
  translateApiExecutionToPostgresExecution,
} = require('@cumulus/db');
const { bootstrapElasticSearch } = require('@cumulus/es-client/bootstrap');
const indexer = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { migrationDir } = require('../../../../lambdas/db-migration');
const { AccessToken, Collection, Execution, Granule } = require('../../models');
// Dynamo mock data factories
const {
  createFakeJwtAuthToken,
  // fakeAccessTokenFactory,
  fakeCollectionFactory,
  fakeGranuleFactoryV2,
  fakeExecutionFactoryV2,
  setAuthorizedOAuthUsers,
} = require('../../lib/testUtils');
const assertions = require('../../lib/assertions');

// create all the variables needed across this test
let accessTokenModel;
let collectionModel;
let collectionPgModel;
let esClient;
let esIndex;
let executionModel;
let executionPgModel;
let granuleModel;
let granulesExecutionsPgModel;
let granulePgModel;
let jwtAuthToken;
const fakeExecutions = [];
process.env.AccessTokensTable = randomId('token');
process.env.CollectionsTable = randomId('collection');
process.env.ExecutionsTable = randomId('executions');
process.env.GranulesTable = randomId('granules');
process.env.stackName = randomId('stackname');
process.env.system_bucket = randomId('systembucket');
process.env.TOKEN_SECRET = randomId('secret');

const testDbName = randomId('execution_test');

// import the express app after setting the env variables
const { app } = require('../../app');

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  esIndex = randomId('esindex');
  t.context.esAlias = randomId('esAlias');
  process.env.ES_INDEX = t.context.esAlias;

  // create esClient
  esClient = await Search.es('fakehost');

  // add fake elasticsearch index
  await bootstrapElasticSearch('fakehost', esIndex, t.context.esAlias);

  // create a fake bucket
  await createBucket(process.env.system_bucket);

  // create a workflow template file
  const tKey = `${process.env.stackName}/workflow_template.json`;
  await s3PutObject({
    Bucket: process.env.system_bucket,
    Key: tKey,
    Body: '{}',
  });

  // Generate a local test postGres database

  const { knex, knexAdmin } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;

  // create fake Collections table
  collectionModel = new Collection();
  await collectionModel.createTable();

  // create fake Granules table
  granuleModel = new Granule();
  await granuleModel.createTable();

  // create fake execution table
  executionModel = new Execution();
  await executionModel.createTable();

  // create fake execution records
  fakeExecutions.push(
    fakeExecutionFactoryV2({
      status: 'completed',
      asyncOperationId: '0fe6317a-233c-4f19-a551-f0f76071402f',
      arn: 'arn2',
    })
  );
  fakeExecutions.push(
    fakeExecutionFactoryV2({ status: 'failed', type: 'workflow2' })
  );
  await Promise.all(
    fakeExecutions.map((i) =>
      executionModel
        .create(i)
        .then((record) =>
          indexer.indexExecution(esClient, record, t.context.esAlias)))
  );

  executionPgModel = new ExecutionPgModel();
  collectionPgModel = new CollectionPgModel();
  granulesExecutionsPgModel = new GranulesExecutionsPgModel();
  granulePgModel = new GranulePgModel();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  // Create collections in Dynamo and Postgres
  // we need this because a granule has a foreign key referring to collections
  const collectionName = 'fakeCollection';
  const collectionVersion = 'v1';

  t.context.testCollection = fakeCollectionFactory({
    name: collectionName,
    version: collectionVersion,
    duplicateHandling: 'error',
  });
  const dynamoCollection = await collectionModel.create(
    t.context.testCollection
  );
  t.context.collectionId = constructCollectionId(
    dynamoCollection.name,
    dynamoCollection.version
  );

  const testPgCollection = fakeCollectionRecordFactory({
    name: collectionName,
    version: collectionVersion,
  });

  [t.context.collectionCumulusId] = await collectionPgModel.create(
    knex,
    testPgCollection
  );

  await esClient.indices.refresh();
});

test.beforeEach(async (t) => {
  const { esAlias, knex } = t.context;

  const workflowName1 = cryptoRandomString({ length: 6 });
  const workflowName2 = cryptoRandomString({ length: 6 });

  // create fake Postgres executon records
  t.context.fakePGExecutions = [
    fakeExecutionRecordFactory({ workflow_name: workflowName1 }),
    fakeExecutionRecordFactory({ workflow_name: workflowName2 }),
  ];

  [t.context.executionCumulusId1, t.context.executionCumulusId2]
    = await Promise.all(
      t.context.fakePGExecutions.map((execution) =>
        executionPgModel.create(knex, execution))
    );

  const granuleId1 = cryptoRandomString({ length: 6 });
  const granuleId2 = cryptoRandomString({ length: 6 });

  // create fake Dynamo granule records
  t.context.fakeGranules = [
    fakeGranuleFactoryV2({ granuleId: granuleId1, status: 'completed' }),
    fakeGranuleFactoryV2({ granuleId: granuleId2, status: 'failed' }),
  ];

  await Promise.all(
    t.context.fakeGranules.map((granule) =>
      granuleModel
        .create(granule)
        .then((record) => indexer.indexGranule(esClient, record, esAlias)))
  );

  // create fake Postgres granule records
  t.context.fakePGGranules = [
    fakeGranuleRecordFactory({
      granule_id: granuleId1,
      status: 'completed',
      collection_cumulus_id: t.context.collectionCumulusId,
    }),
    fakeGranuleRecordFactory({
      granule_id: granuleId2,
      status: 'failed',
      collection_cumulus_id: t.context.collectionCumulusId,
    }),
  ];

  [t.context.granuleCumulusId] = await Promise.all(
    t.context.fakePGGranules.map((granule) =>
      granulePgModel.create(knex, granule))
  );

  t.context.joinRecords = [
    {
      execution_cumulus_id: t.context.executionCumulusId1[0],
      granule_cumulus_id: Number(t.context.granuleCumulusId),
    },
    {
      execution_cumulus_id: t.context.executionCumulusId2[0],
      granule_cumulus_id: Number(t.context.granuleCumulusId),
    },
  ];

  await Promise.all(
    t.context.joinRecords.map((joinRecord) =>
      granulesExecutionsPgModel.create(knex, joinRecord))
  );
});

test.after.always(async (t) => {
  await accessTokenModel.deleteTable();
  await collectionModel.deleteTable();
  await executionModel.deleteTable();
  await granuleModel.deleteTable();
  await esClient.indices.delete({ index: esIndex });
  await recursivelyDeleteS3Bucket(process.env.system_bucket);

  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
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

test('GET executions with asyncOperationId filter returns the correct executions', async (t) => {
  const response = await request(app)
    .get('/executions?asyncOperationId=0fe6317a-233c-4f19-a551-f0f76071402f')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.body.meta.count, 1);
  t.is(response.body.results[0].arn, 'arn2');
});

test('GET returns an existing execution', async (t) => {
  const response = await request(app)
    .get(`/executions/${fakeExecutions[0].arn}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const executionResult = response.body;
  t.is(executionResult.arn, fakeExecutions[0].arn);
  t.is(executionResult.name, fakeExecutions[0].name);
  t.truthy(executionResult.duration);
  t.is(executionResult.status, 'completed');
});

test('GET fails if execution is not found', async (t) => {
  const response = await request(app)
    .get('/executions/unknown')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);

  t.is(response.status, 404);
  t.true(response.body.message.includes('No record found for'));
});

test('DELETE removes only specified execution from all data stores', async (t) => {
  const { knex } = t.context;

  const newExecution = fakeExecutionFactoryV2({
    arn: 'arn3',
    status: 'completed',
    name: 'test_execution',
  });

  fakeExecutions.push(newExecution);

  await Promise.all(
    fakeExecutions.map(async (execution) => {
      // delete async operation foreign key to avoid needing a valid async operation
      delete execution.asyncOperationId;
      await executionModel.create(execution);
      const executionPgRecord = await translateApiExecutionToPostgresExecution(
        execution,
        knex
      );
      await executionPgModel.create(knex, executionPgRecord);
    })
  );

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

test('DELETE returns a 404 if Dynamo execution cannot be found', async (t) => {
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

test('GET /history/:granuleId returns all workflow names associated with the granule', async (t) => {
  const { fakeGranules, fakePGExecutions } = t.context;

  const expectedResponse = [
    fakePGExecutions[0].workflow_name,
    fakePGExecutions[1].workflow_name,
  ];

  const response = await request(app)
    .get(`/executions/history/${fakeGranules[0].granuleId}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);

  t.deepEqual(response.body, expectedResponse);
});

test('POST /history with returns all workflow names associated with the granule', async (t) => {
  const { fakeGranules, fakePGExecutions } = t.context;

  const expectedResponse = [
    fakePGExecutions[0].workflow_name,
    fakePGExecutions[1].workflow_name,
  ];

  const response = await request(app)
    .post('/executions/history')
    .send({ ids: [fakeGranules[0].granuleId, fakeGranules[1].granuleId] })
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);

  t.deepEqual(response.body, expectedResponse);
});

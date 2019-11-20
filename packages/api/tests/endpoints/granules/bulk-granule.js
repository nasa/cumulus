const request = require('supertest');
const sinon = require('sinon');
const test = require('ava');

const { randomString } = require('@cumulus/common/test-utils');
const { createFakeJwtAuthToken } = require('../../../lib/testUtils');

const models = require('../../../models');

const { app } = require('../../../app');

process.env = {
  ...process.env,
  AccessTokensTable: randomString(),
  backgroundQueueName: randomString(),
  CollectionsTable: randomString(),
  GranulesTable: randomString(),
  TOKEN_SECRET: randomString(),
  UsersTable: randomString(),
  stackName: randomString(),
  system_bucket: randomString(),
  AsyncOperationsTable: randomString(),
  AsyncOperationTaskDefinition: randomString(),
  EcsCluster: randomString(),
  BulkOperationLambda: randomString(),
  invoke: randomString(),
  ES_HOST: randomString()
};

let accessTokenModel;
let jwtAuthToken;
let userModel;

test.before(async () => {
  userModel = new models.User();
  await userModel.createTable();

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });
});

test.after.always(async () => {
  await userModel.deleteTable();
  await accessTokenModel.deleteTable();
});

test.serial('Request to granules bulk endpoint starts an async-operation with the correct parameters and list of ids.', async (t) => {
  const asyncOperationId = randomString();
  const asyncOperationStartStub = sinon.stub(models.AsyncOperation.prototype, 'start').returns(
    new Promise((resolve) => resolve({ id: asyncOperationId }))
  );
  const expectedQueueName = 'backgroundProcessing';
  const expectedWorkflowName = 'HelloWorldWorkflow';
  const expectedIds = ['MOD09GQ.A8592978.nofTNT.006.4914003503063'];

  const body = {
    queueName: expectedQueueName,
    workflowName: expectedWorkflowName,
    ids: expectedIds
  };

  await request(app)
    .post('/granules/bulk')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(200);
  const { lambdaName, cluster, payload } = asyncOperationStartStub.args[0][0];

  t.is(asyncOperationStartStub.calledOnce, true);
  t.is(lambdaName, process.env.BulkOperationLambda);
  t.is(cluster, process.env.EcsCluster);
  t.deepEqual(payload, {
    payload: body,
    type: 'BULK_GRANULE',
    granulesTable: process.env.GranulesTable,
    system_bucket: process.env.system_bucket,
    stackName: process.env.stackName,
    invoke: process.env.invoke
  });

  asyncOperationStartStub.restore();
});

test.serial('Request to granules bulk endpoint starts an async-operation with the correct parameters and es query.', async (t) => {
  const asyncOperationId = randomString();
  const asyncOperationStartStub = sinon.stub(models.AsyncOperation.prototype, 'start').returns(
    new Promise((resolve) => resolve({ id: asyncOperationId }))
  );
  const expectedQueueName = 'backgroundProcessing';
  const expectedWorkflowName = 'HelloWorldWorkflow';
  const expectedIndex = 'my-index';
  const expectedQuery = { query: 'fake-query' };

  const body = {
    queueName: expectedQueueName,
    workflowName: expectedWorkflowName,
    index: expectedIndex,
    query: expectedQuery
  };

  await request(app)
    .post('/granules/bulk')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(200);

  const { lambdaName, cluster, payload } = asyncOperationStartStub.args[0][0];
  t.is(asyncOperationStartStub.calledOnce, true);
  t.is(lambdaName, process.env.BulkOperationLambda);
  t.is(cluster, process.env.EcsCluster);
  t.deepEqual(payload, {
    payload: body,
    type: 'BULK_GRANULE',
    granulesTable: process.env.GranulesTable,
    system_bucket: process.env.system_bucket,
    stackName: process.env.stackName,
    invoke: process.env.invoke
  });

  asyncOperationStartStub.restore();
});

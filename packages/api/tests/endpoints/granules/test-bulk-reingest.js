const request = require('supertest');
const sinon = require('sinon');
const test = require('ava');

const asyncOperations = require('@cumulus/async-operations');
const { s3 } = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const { EcsStartTaskError } = require('@cumulus/errors');

const { createFakeJwtAuthToken, setAuthorizedOAuthUsers } = require('../../../lib/testUtils');

const models = require('../../../models');

const { app } = require('../../../app');

const { bulkReingest } = require('../../../endpoints/granules');
const { buildFakeExpressResponse } = require('../utils');

process.env = {
  ...process.env,
  AccessTokensTable: randomId('AccessTokensTable'),
  CollectionsTable: randomId('CollectionsTable'),
  GranulesTable: randomId('GranulesTable'),
  granule_sns_topic_arn: randomString(),
  TOKEN_SECRET: randomId('tokenSecret'),
  stackName: randomId('stackName'),
  system_bucket: randomId('bucket'),
  AsyncOperationsTable: randomId('AsyncOperationsTable'),
  AsyncOperationTaskDefinition: randomId('taskDefinition'),
  EcsCluster: randomId('EcsCluster'),
  BulkOperationLambda: randomId('BulkOperationLambda'),
  invoke: randomId('invoke'),
  ES_HOST: randomId('esHost'),
  METRICS_ES_HOST: randomId('metricsEsHost'),
  METRICS_ES_USER: randomId('metricsEsUser'),
  METRICS_ES_PASS: randomId('metricsEsPass'),
};

let accessTokenModel;
let jwtAuthToken;

test.before(async () => {
  await s3().createBucket({ Bucket: process.env.system_bucket });

  const username = randomId('username');
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
});

test.beforeEach((t) => {
  const asyncOperationId = randomId('asyncOperationId');
  t.context.asyncOperationStartStub = sinon.stub(asyncOperations, 'startAsyncOperation').returns(
    new Promise((resolve) => resolve({ id: asyncOperationId }))
  );
});

test.afterEach.always((t) => {
  t.context.asyncOperationStartStub.restore();
});

test.after.always(async () => {
  await Promise.all([
    recursivelyDeleteS3Bucket(process.env.system_bucket),
    accessTokenModel.deleteTable()]);
});

test.serial('POST /granules/bulkReingest starts an async-operation with the correct payload and list of IDs', async (t) => {
  const { asyncOperationStartStub } = t.context;
  const expectedIds = ['MOD09GQ.A8592978.nofTNT.006.4914003503063'];

  const body = {
    ids: expectedIds,
  };

  const response = await request(app)
    .post('/granules/bulkReingest')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(202);
  // expect a returned async operation ID
  t.truthy(response.body.id);
  const {
    lambdaName,
    cluster,
    description,
    payload,
  } = asyncOperationStartStub.args[0][0];
  t.true(asyncOperationStartStub.calledOnce);
  t.is(lambdaName, process.env.BulkOperationLambda);
  t.is(cluster, process.env.EcsCluster);
  t.is(description, 'Bulk granule reingest run on 1 granules');
  t.deepEqual(payload, {
    payload: body,
    type: 'BULK_GRANULE_REINGEST',
    envVars: {
      ES_HOST: process.env.ES_HOST,
      GranulesTable: process.env.GranulesTable,
      granule_sns_topic_arn: process.env.granule_sns_topic_arn,
      system_bucket: process.env.system_bucket,
      stackName: process.env.stackName,
      invoke: process.env.invoke,
      KNEX_DEBUG: 'false',
      METRICS_ES_HOST: process.env.METRICS_ES_HOST,
      METRICS_ES_USER: process.env.METRICS_ES_USER,
      METRICS_ES_PASS: process.env.METRICS_ES_PASS,
    },
  });
  Object.keys(payload.envVars).forEach((envVarKey) => {
    t.is(payload.envVars[envVarKey], process.env[envVarKey]);
  });
});

test.serial('bulkReingest() uses correct caller lambda function name', async (t) => {
  const { asyncOperationStartStub } = t.context;
  const expectedIds = ['MOD09GQ.A8592978.nofTNT.006.4914003503063'];

  const body = {
    ids: expectedIds,
  };

  const functionName = randomId('lambda');

  await bulkReingest(
    {
      apiGateway: {
        context: {
          functionName,
        },
      },
      body,
    },
    buildFakeExpressResponse()
  );

  t.is(asyncOperationStartStub.getCall(0).firstArg.callerLambdaName, functionName);
});

test.serial('POST /granules/bulkReingest starts an async-operation with the correct payload and ES query', async (t) => {
  const { asyncOperationStartStub } = t.context;
  const expectedIndex = 'my-index';
  const expectedQuery = { query: 'fake-query', size: 2 };

  const body = {
    index: expectedIndex,
    query: expectedQuery,
  };

  const response = await request(app)
    .post('/granules/bulkReingest')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(202);

  // expect a returned async operation ID
  t.truthy(response.body.id);

  const {
    lambdaName,
    cluster,
    description,
    payload,
  } = asyncOperationStartStub.args[0][0];
  t.true(asyncOperationStartStub.calledOnce);
  t.is(lambdaName, process.env.BulkOperationLambda);
  t.is(cluster, process.env.EcsCluster);
  t.is(description, 'Bulk granule reingest run on 2 granules');
  t.deepEqual(payload, {
    payload: body,
    type: 'BULK_GRANULE_REINGEST',
    envVars: {
      ES_HOST: process.env.ES_HOST,
      GranulesTable: process.env.GranulesTable,
      granule_sns_topic_arn: process.env.granule_sns_topic_arn,
      system_bucket: process.env.system_bucket,
      stackName: process.env.stackName,
      invoke: process.env.invoke,
      KNEX_DEBUG: 'false',
      METRICS_ES_HOST: process.env.METRICS_ES_HOST,
      METRICS_ES_USER: process.env.METRICS_ES_USER,
      METRICS_ES_PASS: process.env.METRICS_ES_PASS,
    },
  });
  Object.keys(payload.envVars).forEach((envVarKey) => {
    t.is(payload.envVars[envVarKey], process.env[envVarKey]);
  });
});

test.serial('POST /granules/bulkReingest returns 400 when a query is provided with no index', async (t) => {
  const { asyncOperationStartStub } = t.context;
  const expectedQuery = { query: 'fake-query' };

  const body = {
    query: expectedQuery,
  };

  await request(app)
    .post('/granules/bulkReingest')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /Index is required if query is sent/);

  t.true(asyncOperationStartStub.notCalled);
});

test.serial('POST /granules/bulkReingest returns 400 when no IDs or query is provided', async (t) => {
  const { asyncOperationStartStub } = t.context;
  const expectedIndex = 'my-index';

  const body = {
    index: expectedIndex,
  };

  await request(app)
    .post('/granules/bulkReingest')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /One of ids or query is required/);

  t.true(asyncOperationStartStub.notCalled);
});

test.serial('POST /granules/bulkReingest returns 400 when IDs is not an array', async (t) => {
  const { asyncOperationStartStub } = t.context;
  const expectedIndex = 'my-index';

  const body = {
    index: expectedIndex,
    ids: 'bad-value',
  };

  await request(app)
    .post('/granules/bulkReingest')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /ids should be an array of values/);

  t.true(asyncOperationStartStub.notCalled);
});

test.serial('POST /granules/bulkReingest returns 400 when IDs is an empty array', async (t) => {
  const { asyncOperationStartStub } = t.context;
  const expectedIndex = 'my-index';

  const body = {
    index: expectedIndex,
    ids: [],
  };

  await request(app)
    .post('/granules/bulkReingest')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /no values provided for ids/);

  t.true(asyncOperationStartStub.notCalled);
});

test.serial('POST /granules/bulkReingest returns 400 when the Metrics ELK stack is not configured', async (t) => {
  const { asyncOperationStartStub } = t.context;
  const expectedIndex = 'my-index';
  const expectedQuery = { query: 'fake-query' };

  const body = {
    index: expectedIndex,
    query: expectedQuery,
  };

  process.env.METRICS_ES_USER = undefined;

  await request(app)
    .post('/granules/bulkReingest')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /ELK Metrics stack not configured/);

  t.true(asyncOperationStartStub.notCalled);
});

test.serial('POST /granules/bulkReingest returns 500 if starting ECS task throws unexpected error', async (t) => {
  t.context.asyncOperationStartStub.restore();
  t.context.asyncOperationStartStub = sinon.stub(asyncOperations, 'startAsyncOperation').throws(
    new Error('failed to start')
  );

  const response = await request(app)
    .post('/granules/bulkReingest')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({
      workflowName: 'workflowName',
      ids: [1, 2, 3],
    });
  t.is(response.status, 500);
});

test.serial('POST /granules/bulkReingest returns 503 if starting ECS task throws unexpected error', async (t) => {
  t.context.asyncOperationStartStub.restore();
  t.context.asyncOperationStartStub = sinon.stub(asyncOperations, 'startAsyncOperation').throws(
    new EcsStartTaskError('failed to start')
  );

  const response = await request(app)
    .post('/granules/bulkReingest')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({
      workflowName: 'workflowName',
      ids: [1, 2, 3],
    });
  t.is(response.status, 503);
});

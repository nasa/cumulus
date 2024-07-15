const request = require('supertest');
const sinon = require('sinon');
const test = require('ava');

const { s3 } = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');

const startAsyncOperation = require('../../../lib/startAsyncOperation');
const { createFakeJwtAuthToken, setAuthorizedOAuthUsers } = require('../../../lib/testUtils');

const models = require('../../../models');

const { app } = require('../../../app');

const { bulkReingest } = require('../../../endpoints/granules');
const { buildFakeExpressResponse } = require('../utils');
const { testBulkPayloadEnvVarsMatchSetEnvVars } = require('../../helpers/bulkTestHelpers');

process.env = {
  ...process.env,
  AccessTokensTable: randomId('AccessTokensTable'),
  granule_sns_topic_arn: randomString(),
  TOKEN_SECRET: randomId('tokenSecret'),
  stackName: randomId('stackName'),
  system_bucket: randomId('bucket'),
  AsyncOperationTaskDefinition: randomId('taskDefinition'),
  EcsCluster: randomId('EcsCluster'),
  BulkOperationLambda: randomId('BulkOperationLambda'),
  invoke: randomId('invoke'),
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
  t.context.asyncOperationStartStub = sinon.stub(startAsyncOperation, 'invokeStartAsyncOperationLambda');
});

test.afterEach.always((t) => {
  t.context.asyncOperationStartStub.restore();
});

test.after.always(async () => {
  await Promise.all([
    recursivelyDeleteS3Bucket(process.env.system_bucket),
    accessTokenModel.deleteTable()]);
});

test.serial('POST /granules/bulkReingest starts an async-operation with the correct payload and list of granules', async (t) => {
  const { asyncOperationStartStub } = t.context;

  const body = {
    granules: [
      {
        granuleId: 'MOD09GQ.A8592978.nofTNT.006.4914003503063',
        collectionId: 'name___version',
      },
    ],
    knexDebug: false,
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
    description,
    payload,
  } = asyncOperationStartStub.args[0][0];
  t.true(asyncOperationStartStub.calledOnce);
  t.is(lambdaName, process.env.BulkOperationLambda);
  t.is(description, 'Bulk granule reingest run on 1 granules');
  t.deepEqual(payload, {
    payload: body,
    type: 'BULK_GRANULE_REINGEST',
    envVars: {
      granule_sns_topic_arn: process.env.granule_sns_topic_arn,
      system_bucket: process.env.system_bucket,
      stackName: process.env.stackName,
      invoke: process.env.invoke,
      KNEX_DEBUG: 'false',
    },
  });
  testBulkPayloadEnvVarsMatchSetEnvVars(t, payload);
});

test.serial('bulkReingest() uses correct caller lambda function name', async (t) => {
  const { asyncOperationStartStub } = t.context;

  const body = {
    granules: [
      {
        granuleId: 'MOD09GQ.A8592978.nofTNT.006.4914003503063',
        collectionId: 'name___version',
      },
    ],
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

test.serial('POST /granules/bulkReingest returns 400 when no granules is provided', async (t) => {
  const { asyncOperationStartStub } = t.context;

  const body = {};

  await request(app)
    .post('/granules/bulkReingest')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /Granules is required/);

  t.true(asyncOperationStartStub.notCalled);
});

test.serial('POST /granules/bulkReingest returns 400 when granules is not an array', async (t) => {
  const { asyncOperationStartStub } = t.context;
  const expectedIndex = 'my-index';

  const body = {
    index: expectedIndex,
    granules: 'bad-value',
  };

  await request(app)
    .post('/granules/bulkReingest')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /granules should be an array of values/);

  t.true(asyncOperationStartStub.notCalled);
});

test.serial('POST /granules/bulkReingest returns 400 when granules is an empty array', async (t) => {
  const { asyncOperationStartStub } = t.context;
  const expectedIndex = 'my-index';

  const body = {
    index: expectedIndex,
    granules: [],
  };

  await request(app)
    .post('/granules/bulkReingest')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /no values provided for granules/);

  t.true(asyncOperationStartStub.notCalled);
});

test.serial('POST /granules/bulkReingest returns 500 if invoking StartAsyncOperation lambda throws unexpected error', async (t) => {
  t.context.asyncOperationStartStub.restore();
  t.context.asyncOperationStartStub = sinon.stub(startAsyncOperation, 'invokeStartAsyncOperationLambda').throws(
    new Error('failed to start')
  );

  const response = await request(app)
    .post('/granules/bulkReingest')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({
      workflowName: 'workflowName',
      granules: [
        { granuleId: 1, collectionId: 1 },
        { granuleId: 2, collectionId: 1 },
        { granuleId: 3, collectionId: 1 },
      ],
    });
  t.is(response.status, 500);
});

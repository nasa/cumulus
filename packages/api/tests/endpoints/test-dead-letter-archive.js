const request = require('supertest');
const sinon = require('sinon');
const test = require('ava');

const asyncOperations = require('@cumulus/async-operations');
const { s3 } = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');

const { createFakeJwtAuthToken, setAuthorizedOAuthUsers } = require('../../lib/testUtils');

const models = require('../../models');

const { app } = require('../../app');

const { postRecoverCumulusMessages } = require('../../endpoints/dead-letter-archive');
const { buildFakeExpressResponse } = require('./utils');

process.env = {
  ...process.env,
  AccessTokensTable: randomId('AccessTokensTable'),
  system_bucket: randomId('system'),
  stackName: randomId('stackName'),
  TOKEN_SECRET: randomId('tokenSecret'),
};

let accessTokenModel;
let jwtAuthToken;

test.before(async (t) => {
  await s3().createBucket({ Bucket: process.env.system_bucket });

  const username = randomId('username');
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
  const asyncOperationId = randomId('asyncOperationId');
  t.context.asyncOperationId = asyncOperationId;
  t.context.asyncOperationStartStub = sinon.stub(asyncOperations, 'startAsyncOperation').returns(
    new Promise((resolve) => resolve({ id: asyncOperationId }))
  );
});

test.beforeEach((t) => {
  t.context.asyncOperationStartStub.resetHistory();
});

test.after.always(async (t) => {
  t.context.asyncOperationStartStub.restore();
  await Promise.all([
    recursivelyDeleteS3Bucket(process.env.system_bucket),
    accessTokenModel.deleteTable()]);
});

test.serial('POST /deadLetterArchive/recoverCumulusMessages starts an async-operation with specified payload', async (t) => {
  const { asyncOperationStartStub } = t.context;
  const archiveBucket = 'archiveBucket';
  const archivePath = 'archivePath';

  const body = {
    bucket: archiveBucket,
    path: archivePath,
  };

  const response = await request(app)
    .post('/deadLetterArchive/recoverCumulusMessages')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(202);
  // expect a returned async operation ID
  t.is(response.body.id, t.context.asyncOperationId);
  const {
    lambdaName,
    cluster,
    description,
    payload,
  } = asyncOperationStartStub.args[0][0];
  t.true(asyncOperationStartStub.calledOnce);
  t.is(lambdaName, process.env.MigrationCountToolLambda);
  t.is(cluster, process.env.EcsCluster);
  t.is(description, 'Dead-Letter Processor ECS Run');
  t.deepEqual(payload, {
    batchSize: 1000,
    bucket: archiveBucket,
    concurrency: 10,
    path: archivePath,
  });
});

test.serial('POST /deadLetterArchive/recoverCumulusMessages starts an async-operation with unspecified payload', async (t) => {
  const { asyncOperationStartStub } = t.context;

  const response = await request(app)
    .post('/deadLetterArchive/recoverCumulusMessages')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({})
    .expect(202);
  // expect a returned async operation ID
  t.is(response.body.id, t.context.asyncOperationId);
  const {
    lambdaName,
    cluster,
    description,
    payload,
  } = asyncOperationStartStub.args[0][0];
  t.true(asyncOperationStartStub.calledOnce);
  t.is(lambdaName, process.env.MigrationCountToolLambda);
  t.is(cluster, process.env.EcsCluster);
  t.is(description, 'Dead-Letter Processor ECS Run');
  t.deepEqual(payload, {
    batchSize: 1000,
    bucket: undefined,
    concurrency: 10,
    path: undefined,
  });
});

test.serial('postRecoverCumulusMessages() uses correct caller lambda function name', async (t) => {
  const { asyncOperationStartStub } = t.context;

  const functionName = randomId('lambda');
  await postRecoverCumulusMessages(
    {
      apiGateway: {
        context: {
          functionName,
        },
      },
    },
    buildFakeExpressResponse()
  );

  const {
    lambdaName,
    cluster,
    description,
    payload,
    callerLambdaName,
  } = asyncOperationStartStub.args[0][0];
  t.true(asyncOperationStartStub.calledOnce);
  t.is(callerLambdaName, functionName);
  t.is(lambdaName, process.env.MigrationCountToolLambda);
  t.is(cluster, process.env.EcsCluster);
  t.is(description, 'Dead-Letter Processor ECS Run');
  t.deepEqual(payload, {
    batchSize: 1000,
    bucket: undefined,
    concurrency: 10,
    path: undefined,
  });
});

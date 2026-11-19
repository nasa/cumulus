const request = require('supertest');
const sinon = require('sinon');
const test = require('ava');

const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');

const startAsyncOperation = require('../../lib/startAsyncOperation');
const { createFakeJwtAuthToken, setAuthorizedOAuthUsers } = require('../../lib/testUtils');
const models = require('../../models');
const { app } = require('../../app');

process.env = {
  ...process.env,
  AccessTokensTable: randomString(),
  TOKEN_SECRET: randomString(),
  stackName: randomString(),
  system_bucket: randomString(),
  AsyncOperationTaskDefinition: randomString(),
  EcsCluster: randomString(),
  ExportTableLambda: randomString(),
};

let accessTokenModel;
let jwtAuthToken;

test.before(async () => {
  await s3().createBucket({ Bucket: process.env.system_bucket });

  const username = randomString();
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
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await accessTokenModel.deleteTable();
});

const exportEndpointCases = [
  { path: '/granules/export', resourceType: 'granule' },
  { path: '/executions/export', resourceType: 'execution' },
  { path: '/collections/export', resourceType: 'collection' },
  { path: '/providers/export', resourceType: 'provider' },
  { path: '/pdrs/export', resourceType: 'pdr' },
];

exportEndpointCases.forEach(({ path, resourceType }) => {
  test.serial(`POST ${path} starts an 'Export Table' async-operation with the given queryStringParameters`, async (t) => {
    const { asyncOperationStartStub } = t.context;
    const queryStringParameters = { status: 'completed', sort_by: 'createdAt' };

    const response = await request(app)
      .post(path)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send({ queryStringParameters })
      .expect(202);

    t.truthy(response.body.id);
    t.true(asyncOperationStartStub.calledOnce);

    const { lambdaName, operationType, payload } = asyncOperationStartStub.args[0][0];
    t.is(lambdaName, process.env.ExportTableLambda);
    t.is(operationType, 'Export Table');
    t.deepEqual(payload, { resourceType, queryStringParameters });
  });

  test.serial(`POST ${path} defaults queryStringParameters to {} when the request body omits it`, async (t) => {
    const { asyncOperationStartStub } = t.context;

    await request(app)
      .post(path)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send({})
      .expect(202);

    const { payload } = asyncOperationStartStub.args[0][0];
    t.deepEqual(payload, { resourceType, queryStringParameters: {} });
  });

  test.serial(`POST ${path} returns 500 if invoking StartAsyncOperation lambda throws unexpected error`, async (t) => {
    t.context.asyncOperationStartStub.restore();
    t.context.asyncOperationStartStub = sinon.stub(startAsyncOperation, 'invokeStartAsyncOperationLambda').throws(
      new Error('failed to start')
    );

    const response = await request(app)
      .post(path)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send({ queryStringParameters: {} });

    t.is(response.status, 500);
  });
});

'use strict';

const test = require('ava');
const request = require('supertest');
const sinon = require('sinon');

const omit = require('lodash/omit');

const { s3 } = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString, randomId } = require('@cumulus/common/test-utils');

const startAsyncOperation = require('../../../lib/startAsyncOperation');
const {
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers,
} = require('../../../lib/testUtils');
const AccessToken = require('../../../models/access-tokens');
const { generateListOfGranules } = require('../../helpers/create-test-data');

let accessTokenModel;
let jwtAuthToken;

// import the express app after setting the env variables
const { app } = require('../../../app');

const { bulkDelete } = require('../../../endpoints/granules');
const { buildFakeExpressResponse } = require('../utils');

test.before(async () => {
  process.env.AsyncOperationsTable = randomString();
  process.env.AsyncOperationTaskDefinition = randomString();
  process.env.BulkOperationLambda = randomString();
  process.env.EcsCluster = randomString();
  process.env.stackName = randomString();
  process.env.system_bucket = randomString();
  process.env.TOKEN_SECRET = randomString();
  process.env.AccessTokensTable = randomString();
  process.env.METRICS_ES_HOST = randomString();
  process.env.METRICS_ES_USER = randomString();
  process.env.METRICS_ES_PASS = randomString();
  process.env.CMR_ENVIRONMENT = randomString();
  process.env.cmr_client_id = randomString();
  process.env.cmr_oauth_provider = randomString();
  process.env.cmr_password_secret_name = randomString();
  process.env.cmr_provider = randomString();
  process.env.cmr_username = randomString();
  process.env.launchpad_api = randomString();
  process.env.launchpad_certificate = randomString();
  process.env.launchpad_passphrase_secret_name = randomString();
  process.env.ES_HOST = randomString();

  await s3().createBucket({ Bucket: process.env.system_bucket });

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new AccessToken();
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

test.serial('POST /granules/bulkDelete starts an async-operation with the correct payload and list of granules', async (t) => {
  const { asyncOperationStartStub } = t.context;

  const body = {
    granules: [
      {
        granuleId: 'MOD09GQ.A8592978.nofTNT.006.4914003503063',
        collectionId: 'name___version',
      },
    ],
    forceRemoveFromCmr: true,
  };

  const response = await request(app)
    .post('/granules/bulkDelete')
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
  t.is(description, 'Bulk granule deletion');
  t.deepEqual(payload, {
    payload: {
      ...body,
      concurrency: 10,
      maxDbConnections: 10,
    },
    type: 'BULK_GRANULE_DELETE',
    envVars: {
      cmr_client_id: process.env.cmr_client_id,
      CMR_ENVIRONMENT: process.env.CMR_ENVIRONMENT,
      cmr_oauth_provider: process.env.cmr_oauth_provider,
      cmr_password_secret_name: process.env.cmr_password_secret_name,
      cmr_provider: process.env.cmr_provider,
      cmr_username: process.env.cmr_username,
      KNEX_DEBUG: 'false',
      launchpad_api: process.env.launchpad_api,
      launchpad_certificate: process.env.launchpad_certificate,
      launchpad_passphrase_secret_name: process.env.launchpad_passphrase_secret_name,
      METRICS_ES_HOST: process.env.METRICS_ES_HOST,
      METRICS_ES_USER: process.env.METRICS_ES_USER,
      METRICS_ES_PASS: process.env.METRICS_ES_PASS,
      stackName: process.env.stackName,
      system_bucket: process.env.system_bucket,
      ES_HOST: process.env.ES_HOST,
    },
  });
  Object.keys(omit(payload.envVars, ['KNEX_DEBUG'])).forEach((envVarKey) => {
    t.is(payload.envVars[envVarKey], process.env[envVarKey]);
  });
});

test.serial('bulkDelete() uses correct caller lambda function name', async (t) => {
  const { asyncOperationStartStub } = t.context;

  const body = {
    granules: [
      {
        granuleId: 'MOD09GQ.A8592978.nofTNT.006.4914003503063',
        collectionId: 'name___version',
      },
    ],
    forceRemoveFromCmr: true,
  };

  const functionName = randomId('lambda');

  await bulkDelete(
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

test.serial('POST /granules/bulkDelete starts an async-operation with the correct payload and ES query', async (t) => {
  const { asyncOperationStartStub } = t.context;
  const expectedIndex = 'my-index';
  const expectedQuery = { query: 'fake-query', size: 2 };

  const body = {
    index: expectedIndex,
    query: expectedQuery,
  };

  const response = await request(app)
    .post('/granules/bulkDelete')
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
  t.is(description, 'Bulk granule deletion');
  t.deepEqual(payload, {
    payload: {
      ...body,
      concurrency: 10,
      maxDbConnections: 10,
    },
    type: 'BULK_GRANULE_DELETE',
    envVars: {
      cmr_client_id: process.env.cmr_client_id,
      CMR_ENVIRONMENT: process.env.CMR_ENVIRONMENT,
      cmr_oauth_provider: process.env.cmr_oauth_provider,
      cmr_password_secret_name: process.env.cmr_password_secret_name,
      cmr_provider: process.env.cmr_provider,
      cmr_username: process.env.cmr_username,
      KNEX_DEBUG: 'false',
      launchpad_api: process.env.launchpad_api,
      launchpad_certificate: process.env.launchpad_certificate,
      launchpad_passphrase_secret_name: process.env.launchpad_passphrase_secret_name,
      METRICS_ES_HOST: process.env.METRICS_ES_HOST,
      METRICS_ES_USER: process.env.METRICS_ES_USER,
      METRICS_ES_PASS: process.env.METRICS_ES_PASS,
      stackName: process.env.stackName,
      system_bucket: process.env.system_bucket,
      ES_HOST: process.env.ES_HOST,
    },
  });
  Object.keys(omit(payload.envVars, ['KNEX_DEBUG'])).forEach((envVarKey) => {
    t.is(payload.envVars[envVarKey], process.env[envVarKey]);
  });
});

test.serial('POST /granules/bulkDelete returns a 400 when a query is provided with no index', async (t) => {
  const { asyncOperationStartStub } = t.context;
  const expectedQuery = { query: 'fake-query' };

  const body = {
    query: expectedQuery,
  };

  await request(app)
    .post('/granules/bulkDelete')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /Index is required if query is sent/);

  t.true(asyncOperationStartStub.notCalled);
});

test.serial('POST /granules/bulkDelete returns 400 when no granules or Query is provided', async (t) => {
  const { asyncOperationStartStub } = t.context;

  const body = {};
  await request(app)
    .post('/granules/bulkDelete')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /One of granules or query is required/);

  t.true(asyncOperationStartStub.notCalled);
});

test.serial('POST /granules/bulkDelete returns 400 when granules are not an array', async (t) => {
  const { asyncOperationStartStub } = t.context;

  const body = {
    granules: 'bad-value',
  };
  await request(app)
    .post('/granules/bulkDelete')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /granules should be an array of values/);

  t.true(asyncOperationStartStub.notCalled);
});

test.serial('POST /granules/bulkDelete returns 400 when granules is an empty array of values', async (t) => {
  const { asyncOperationStartStub } = t.context;

  const body = {
    granules: [],
  };
  await request(app)
    .post('/granules/bulkDelete')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /no values provided for granules/);

  t.true(asyncOperationStartStub.notCalled);
});

test.serial('POST /granules/bulkDelete returns 400 when the Metrics ELK stack is not configured', async (t) => {
  const { asyncOperationStartStub } = t.context;

  const body = {
    query: 'fake-query',
  };

  delete process.env.METRICS_ES_HOST;
  t.teardown(() => {
    process.env.METRICS_ES_HOST = randomString();
  });

  await request(app)
    .post('/granules/bulkDelete')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /ELK Metrics stack not configured/);

  t.true(asyncOperationStartStub.notCalled);
});

test.serial('POST /granules/bulkDelete returns a 400 when forceRemoveFromCmr is not a boolean value', async (t) => {
  const { asyncOperationStartStub } = t.context;

  const body = {
    granules: [
      {
        granuleId: 'MOD09GQ.A8592978.nofTNT.006.4914003503063',
        collectionId: 'name___version',
      },
    ],
    forceRemoveFromCmr: 'true',
  };

  await request(app)
    .post('/granules/bulkDelete')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /forceRemoveFromCmr must be a boolean value/);

  t.true(asyncOperationStartStub.notCalled);
});

test.serial('POST /granules/bulkDelete returns a 400 when maxDbConnections is not an integer', async (t) => {
  const { asyncOperationStartStub } = t.context;
  const body = {
    granules: [
      {
        granuleId: 'MOD09GQ.A8592978.nofTNT.006.4914003503063',
        collectionId: 'name___version',
      },
    ],
    maxDbConnections: 'one hundred',
  };

  await request(app)
    .post('/granules/bulkDelete')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /Expected number, received string at maxDbConnections/);

  t.true(asyncOperationStartStub.notCalled);
});

test.serial('POST /granules/bulkDelete returns a 400 when concurrency is not an integer', async (t) => {
  const { asyncOperationStartStub } = t.context;
  const body = {
    granules: [
      {
        granuleId: 'MOD09GQ.A8592978.nofTNT.006.4914003503063',
        collectionId: 'name___version',
      },
    ],
    concurrency: 'one hundred',
  };

  await request(app)
    .post('/granules/bulkDelete')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(400, /Expected number, received string at concurrency/);

  t.true(asyncOperationStartStub.notCalled);
});

test.serial('POST /granules/bulkDelete returns a 401 status code if valid authorization is not specified', async (t) => {
  const response = await request(app)
    .post('/granules/bulkDelete')
    .set('Accept', 'application/json')
    .expect(401);

  t.is(response.status, 401);
});

test.serial('request to /granules/bulkDelete endpoint returns 500 if invoking StartAsyncOperation lambda throws unexpected error', async (t) => {
  t.context.asyncOperationStartStub.restore();
  t.context.asyncOperationStartStub = sinon.stub(startAsyncOperation, 'invokeStartAsyncOperationLambda').throws(
    new Error('failed to start')
  );

  const body = {
    granules: [
      {
        granuleId: 'MOD09GQ.A8592978.nofTNT.006.4914003503063',
        collectionId: 'name___version',
      },
    ],
  };

  const response = await request(app)
    .post('/granules/bulkDelete')
    .send(body)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`);
  t.is(response.status, 500);
});

test.serial('POST /granules/bulkDelete starts an async-operation with a large list of granules as input', async (t) => {
  const body = {
    granules: generateListOfGranules(),
    forceRemoveFromCmr: true,
  };

  const response = await request(app)
    .post('/granules/bulkDelete')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(202);

  // expect a returned async operation ID
  t.truthy(response.body.id);
});

'use strict';

const request = require('supertest');
const sinon = require('sinon');
const test = require('ava');

const asyncOperations = require('@cumulus/async-operations');
const awsServices = require('@cumulus/aws-client/services');
const SQS = require('@cumulus/aws-client/SQS');
const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomId, randomString } = require('@cumulus/common/test-utils');

const models = require('../../models');
const { app } = require('../../app');
const { createFakeJwtAuthToken, setAuthorizedOAuthUsers } = require('../../lib/testUtils');

/**
 * create a source queue
 *
 * @param {string} queueNamePrefix - prefix of the queue name
 * @param {string} visibilityTimeout - visibility timeout for queue messages
 * @returns {Object} - {queueUrl: <url>} queue created
 */
async function createSqsQueues(
  queueNamePrefix,
  visibilityTimeout = '300'
) {
  // source queue
  const queueName = `${queueNamePrefix}Queue`;
  const queueParms = {
    QueueName: queueName,
    Attributes: {
      VisibilityTimeout: visibilityTimeout,
    },
  };

  const { QueueUrl: queueUrl } = await awsServices.sqs().createQueue(queueParms).promise();
  return { queueName, queueUrl };
}

process.env = {
  ...process.env,
  AccessTokensTable: randomId('AccessTokensTable'),
  AsyncOperationsTable: randomId('asyncOperationsTable'),
  system_bucket: randomId('systemBucket'),
  stackName: randomId('stackName'),
  TOKEN_SECRET: randomId('tokenSecret'),
  ReplayArchivedS3MessagesLambda: randomId('ReplayArchivedS3MessagesLambda'),
};

let accessTokenModel;
let jwtAuthToken;

test.before(async (t) => {
  await s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  const username = randomId('username');
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
  const asyncOperationId = randomId('asyncOperationId');
  t.context.asyncOperationStartStub = sinon.stub(asyncOperations, 'startAsyncOperation').returns(
    new Promise((resolve) => resolve({ id: asyncOperationId }))
  );
  t.context.queues = await createSqsQueues(randomString());
});

test.beforeEach((t) => {
  t.context.asyncOperationStartStub.resetHistory();
});

test.after.always(async (t) => {
  t.context.asyncOperationStartStub.restore();
  await SQS.deleteQueue(t.context.queues.queueUrl);
  await Promise.all([
    recursivelyDeleteS3Bucket(process.env.system_bucket),
    accessTokenModel.deleteTable()]);
});

test.serial('POST /replaySqsMessages starts an async-operation with specified payload', async (t) => {
  const { asyncOperationStartStub, queues } = t.context;
  const body = {
    type: 'sqs',
    queueName: queues.queueName,
  };

  const response = await request(app)
    .post('/replaySqsMessages')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(body)
    .expect(202);

  // expect a returned async operation ID
  t.truthy(response.body.asyncOperationId);
  const {
    lambdaName,
    cluster,
    description,
    payload,
  } = asyncOperationStartStub.args[0][0];
  t.true(asyncOperationStartStub.calledOnce);
  t.is(cluster, process.env.EcsCluster);
  t.is(description, 'SQS Replay');
  t.is(lambdaName, process.env.ReplaySqsMessagesLambda);
  t.deepEqual(payload, body);
});

test.serial('POST /replaySqsMessages does not start an async-operation without queueName', async (t) => {
  const { asyncOperationStartStub } = t.context;
  await request(app)
    .post('/replaySqsMessages')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ type: 'sqs' })
    .expect(400);
  t.false(asyncOperationStartStub.called);
});

test.serial('POST /replaySqsMessages does not start an async-operation without type', async (t) => {
  const { asyncOperationStartStub } = t.context;
  await request(app)
    .post('/replaySqsMessages')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ queueName: 'some-queue' })
    .expect(400);
  t.false(asyncOperationStartStub.called);
});

test.serial('POST /replaySqsMessages returns Internal Server Error if SQS queue does not exist', async (t) => {
  const { asyncOperationStartStub } = t.context;
  await request(app)
    .post('/replaySqsMessages')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ queueName: 'some-queue', type: 'sqs' })
    .expect(500);
  t.false(asyncOperationStartStub.called);
});

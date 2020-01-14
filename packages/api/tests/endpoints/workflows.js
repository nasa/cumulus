'use strict';

const test = require('ava');
const request = require('supertest');
const { randomString } = require('@cumulus/common/test-utils');

const { s3 } = require('@cumulus/aws-client/services');
const {
  promiseS3Upload,
  recursivelyDeleteS3Bucket
} = require('@cumulus/aws-client/S3');

const models = require('../../models');
const {
  createFakeJwtAuthToken,
  getWorkflowList,
  setAuthorizedOAuthUsers
} = require('../../lib/testUtils');
const assertions = require('../../lib/assertions');

process.env.TOKEN_SECRET = randomString();
process.env.AccessTokensTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();

// import the express app after setting the env variables
const { app } = require('../../app');

const workflowList = getWorkflowList();
let accessTokenModel;
let testBucketName;
let jwtAuthToken;

test.before(async () => {
  testBucketName = process.env.system_bucket;

  await s3().createBucket({ Bucket: testBucketName }).promise();
  await Promise.all(workflowList.map((wf) => {
    const workflowsListKey = `${process.env.stackName}/workflows/${wf.name}.json`;
    return promiseS3Upload({
      Bucket: testBucketName,
      Key: workflowsListKey,
      Body: JSON.stringify(wf)
    });
  }));

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  await s3().createBucket({ Bucket: testBucketName }).promise();
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await recursivelyDeleteS3Bucket(testBucketName);
});

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/workflows')
    .set('Accept', 'application/json')
    .expect(401);
  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-911 GET with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/workflows/asdf')
    .set('Accept', 'application/json')
    .expect(401);
  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 GET without pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/workflows/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);
  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 GET without pathParameters and with an unauthorized user returns an unauthorized response');
test.todo('CUMULUS-912 GET with pathParameters and with an unauthorized user returns an unauthorized response');

test('GET with no path parameters and an authorized user returns a list of workflows', async (t) => {
  const response = await request(app)
    .get('/workflows')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.status, 200);
  // order of response is not guaranteed
  t.is(workflowList.length, response.body.length);
});

test('GET an existing workflow with an authorized user returns a specific workflow', async (t) => {
  const response = await request(app)
    .get('/workflows/HelloWorldWorkflow')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.is(response.status, 200);
  t.deepEqual(response.body, workflowList[0]);
});

test('GET with path parameters returns a 404 for a nonexistent workflow', async (t) => {
  const response = await request(app)
    .get('/workflows/NonexistentWorkflow')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);

  t.is(response.status, 404);
  t.is(response.body.message, 'Workflow does not exist!');
});

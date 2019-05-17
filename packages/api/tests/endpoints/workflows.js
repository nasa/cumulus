'use strict';

const test = require('ava');
const request = require('supertest');
const { randomString } = require('@cumulus/common/test-utils');
const {
  s3,
  promiseS3Upload,
  recursivelyDeleteS3Bucket
} = require('@cumulus/common/aws');

const workflowList = require('../data/workflow_list.json');
const models = require('../../models');
const {
  createFakeJwtAuthToken
} = require('../../lib/testUtils');
const assertions = require('../../lib/assertions');

process.env.TOKEN_SECRET = randomString();
process.env.AccessTokensTable = randomString();
process.env.UsersTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();

// import the express app after setting the env variables
const { app } = require('../../app');

let accessTokenModel;
let userModel;
let testBucketName;
let jwtAuthToken;

test.before(async () => {
  testBucketName = process.env.system_bucket;

  await s3().createBucket({ Bucket: testBucketName }).promise();
  const workflowsListKey = `${process.env.stackName}/workflows/list.json`;
  await promiseS3Upload({
    Bucket: testBucketName,
    Key: workflowsListKey,
    Body: JSON.stringify(workflowList)
  });

  userModel = new models.User();
  await userModel.createTable();

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, userModel });

  await s3().createBucket({ Bucket: testBucketName }).promise();
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await userModel.deleteTable();
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
  t.deepEqual(response.body, workflowList);
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
  t.is(response.body.message, 'The specified workflow does not exist.');
});

test.serial('GET /good-workflow returns a 404 if the workflows list cannot be fetched from S3', async (t) => {
  const realBucket = process.env.system_bucket;
  process.env.system_bucket = 'bucket-does-not-exist';
  const response = await request(app)
    .get('/workflows/HelloWorldWorkflow')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);

  t.is(response.status, 404);
  process.env.system_bucket = realBucket;
});

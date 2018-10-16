'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const {
  s3,
  promiseS3Upload,
  recursivelyDeleteS3Bucket
} = require('@cumulus/common/aws');

const models = require('../../models');
const workflowsEndpoint = require('../../endpoints/workflows');
const {
  fakeUserFactory,
  testEndpoint
} = require('../../lib/testUtils');
const assertions = require('../../lib/assertions');

const workflowList = require('../data/workflow_list.json');

let authHeaders;
let userModel;
let testBucketName;
test.before(async () => {
  process.env.UsersTable = randomString();

  userModel = new models.User();
  await userModel.createTable();

  const authToken = (await userModel.create(fakeUserFactory())).password;
  authHeaders = {
    Authorization: `Bearer ${authToken}`
  };

  testBucketName = randomString();
  process.env.bucket = testBucketName;

  await s3().createBucket({ Bucket: testBucketName }).promise();
});

test.after.always(async () => {
  await userModel.deleteTable();
  await recursivelyDeleteS3Bucket(testBucketName);
});

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {}
  };

  return testEndpoint(workflowsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 GET with pathParameters and without an Authorization header returns an Authorization Missing response', (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      name: 'asdf'
    },
    headers: {}
  };

  return testEndpoint(workflowsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-912 GET without pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(workflowsEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('CUMULUS-912 GET with pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      name: 'asdf'
    },
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(workflowsEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test.serial('GET with no path parameters returns a list of workflows', async (t) => {
  const stackName = randomString();
  process.env.stackName = stackName;

  const workflowsListKey = `${stackName}/workflows/list.json`;

  await promiseS3Upload({
    Bucket: testBucketName,
    Key: workflowsListKey,
    Body: JSON.stringify(workflowList)
  });

  const request = {
    httpMethod: 'GET',
    headers: authHeaders
  };

  return testEndpoint(workflowsEndpoint, request, (response) => {
    t.is(response.statusCode, 200);

    const parsedBody = JSON.parse(response.body);
    t.deepEqual(parsedBody, workflowList);
  });
});

test.todo('GET /good-workflow returns a workflow that exists');

test.todo('GET /bad-workflow returns a 404 for a workflow that does not exist');

test.todo('GET /good-workflow returns a 500 if the workflows list cannot be fetched from S3');

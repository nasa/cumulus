'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const {
  s3,
  promiseS3Upload,
  recursivelyDeleteS3Bucket
} = require('@cumulus/common/aws');

const workflowList = require('../data/workflow_list.json');
const models = require('../../models');
const workflowsEndpoint = require('../../endpoints/workflows');
const {
  fakeUserFactory,
  testEndpoint
} = require('../../lib/testUtils');
const assertions = require('../../lib/assertions');

let authHeaders;
let userModel;
let testBucketName;
let stackName;

test.before(async () => {
  process.env.UsersTable = randomString();
  testBucketName = randomString();
  stackName = randomString();

  process.env.stackName = stackName;
  process.env.bucket = testBucketName;

  await s3().createBucket({ Bucket: testBucketName }).promise();
  const workflowsListKey = `${process.env.stackName}/workflows/list.json`; // eslint-disable-line max-len
  await promiseS3Upload({
    Bucket: testBucketName,
    Key: workflowsListKey,
    Body: JSON.stringify(workflowList)
  });

  userModel = new models.User();
  await userModel.createTable();

  const authToken = (await userModel.create(fakeUserFactory())).password;
  authHeaders = {
    Authorization: `Bearer ${authToken}`
  };

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

test('GET with no path parameters and an authorized user returns a list of workflows', async (t) => {
  const request = {
    httpMethod: 'GET',
    headers: authHeaders
  };

  return testEndpoint(workflowsEndpoint, request, (response) => {
    t.is(response.statusCode, 200);
    const results = JSON.parse(response.body);

    t.deepEqual(results, workflowList);
  });
});

test('GET an existing workflow with an authorized user returns a specific workflow', async (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      name: 'HelloWorldWorkflow'
    },
    headers: authHeaders
  };

  return testEndpoint(workflowsEndpoint, request, (response) => {
    t.is(response.statusCode, 200);

    const result = JSON.parse(response.body);
    t.deepEqual(result, workflowList[0]);
  });
});

test('GET with path parameters returns a 404 for a nonexistent workflow', async (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      name: 'NonexistentWorkflow'
    },
    headers: authHeaders
  };

  return testEndpoint(workflowsEndpoint, request, (response) => {
    t.is(response.statusCode, 404);

    const result = JSON.parse(response.body);
    t.is(result.message, 'The specified workflow does not exist.');
  });
});

test.serial('GET /good-workflow returns a 500 if the workflows list cannot be fetched from S3', async (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      name: 'HelloWorldWorkflow'
    },
    headers: authHeaders
  };

  const realBucket = process.env.bucket;
  process.env.bucket = 'bucket-does-not-exist';

  return testEndpoint(workflowsEndpoint, request, (response) => {
    process.env.bucket = realBucket;
    t.is(response.statusCode, 500);
  });
});

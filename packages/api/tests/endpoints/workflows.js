'use strict';

const test = require('ava');
const sinon = require('sinon');
const { randomString } = require('@cumulus/common/test-utils');
const workflowList = require('../data/workflow_list.json');
const { 
  s3,
  promiseS3Upload,
  recursivelyDeleteS3Bucket
} = require('@cumulus/common/aws')

const models = require('../../models');
const workflowsEndpoint = require('../../endpoints/workflows');
const {
  fakeUserFactory,
  testEndpoint
} = require('../../lib/testUtils');
const assertions = require('../../lib/assertions');

let authHeaders;
let userModel;
test.before(async (t) => {
  process.env.UsersTable = randomString();

  userModel = new models.User();
  await userModel.createTable();

  const authToken = (await userModel.create(fakeUserFactory())).password;
  authHeaders = {
    Authorization: `Bearer ${authToken}`
  };
});

test.after.always(async (t) => {
  userModel.deleteTable();
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

test('with an authorized user returns a list of workflows', async (t) => {
  t.context.testBucketName = randomString();
  process.env.bucket = t.context.testBucketName;
  await s3().createBucket({ Bucket: t.context.testBucketName }).promise();
  const key = `${process.env.stackName}/workflows/list.json`; // eslint-disable-line max-len
  await promiseS3Upload({
    Bucket: t.context.testBucketName,
    Key: key,
    Body: JSON.stringify(workflowList),
    ACL: 'public-read'
  });

  const request = {
    httpMethod: 'GET',
    headers: authHeaders
  };

  // const stub = sinon.stub(S3.prototype, 'get').resolves({
  //   results: workflowsList
  // });

  return testEndpoint(workflowsEndpoint, request, (response) => {
    const { results } = JSON.parse(response.body);
    // stub.restore();
    console.log(results);
    t.is(results.length, 1);
  });

  await recursivelyDeleteS3Bucket({ Bucket: t.context.testBucketName });
});

'use strict';

const test = require('ava');
const {
  testUtils: { randomString }
} = require('@cumulus/common');
const bulkDeleteEndpoint = require('../../endpoints/bulk-delete');
const { AccessToken, User } = require('../../models');
const { createAccessToken } = require('../../lib/testUtils');

let accessTokenModel;
let userModel;
let authHeaders;
let context;

test.before(async () => {
  // Create Users table
  process.env.UsersTable = randomString();
  userModel = new User();
  await userModel.createTable();

  process.env.AccessTokensTable = randomString();
  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  process.env.TOKEN_SECRET = randomString();
  const accessToken = await createAccessToken({ accessTokenModel, userModel });
  authHeaders = {
    Authorization: `Bearer ${accessToken}`
  };

  context = {
    AsyncOperationsTable: randomString(),
    AsyncOperationTaskDefinition: randomString(),
    BulkDeleteLambda: randomString(),
    EcsCluster: randomString(),
    stackName: randomString(),
    systemBucket: randomString(),
    UsersTable: process.env.UsersTable
  };
});

test.after.always(async () => {
  try {
    await userModel.deleteTable();
  }
  catch (err) {
    if (err.code !== 'ResourceNotFoundException') throw err;
  }

  await accessTokenModel.deleteTable();
});

test.serial('GET /bulkDelete returns a 404 status code', async (t) => {
  const event = {
    headers: authHeaders,
    httpMethod: 'GET'
  };

  const response = await bulkDeleteEndpoint(event, context);

  t.is(response.statusCode, 404);
});

test.serial('POST /bulkDelete returns a 401 status code if valid authorization is not specified', async (t) => {
  const event = {
    headers: {},
    httpMethod: 'POST'
  };

  const response = await bulkDeleteEndpoint(event, context);

  t.is(response.statusCode, 401);
});

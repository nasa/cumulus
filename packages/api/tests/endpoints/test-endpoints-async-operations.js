'use strict';

const test = require('ava');

const {
  testUtils: { randomString }
} = require('@cumulus/common');

const asyncOperationsEndpoint = require('../../endpoints/async-operations');
const {
  AsyncOperation: AsyncOperationModel,
  User
} = require('../../models');
const {
  createFakeUser
} = require('../../lib/testUtils');

let asyncOperationModel;
let userModel;
let authHeaders;
let context;

test.before(async () => {
  // Create AsyncOperations table
  asyncOperationModel = new AsyncOperationModel({ tableName: randomString() });
  await asyncOperationModel.createTable();

  // Create Users table
  userModel = new User(randomString());
  await User.createTable(userModel.tableName, { name: 'userName', type: 'S' });

  const authToken = (await createFakeUser({ userDbClient: userModel })).password;
  authHeaders = {
    Authorization: `Bearer ${authToken}`
  };

  context = {
    AsyncOperationsTable: asyncOperationModel.tableName,
    UsersTable: userModel.tableName
  };
});

test.after.always(async () => {
  await asyncOperationModel.deleteTable();
  await userModel.deleteTable();
});

test.serial('GET /async-operation returns a 404 status code', async (t) => {
  const event = {
    headers: authHeaders,
    httpMethod: 'GET'
  };

  const response = await asyncOperationsEndpoint(event, context);

  t.is(response.statusCode, 404);
});

test.serial('GET /async-operation/{:id} returns a 401 status code if valid authorization is not specified', async (t) => {
  const event = {
    headers: {},
    httpMethod: 'GET',
    pathParameters: {
      id: 'abc-123'
    }
  };

  const response = await asyncOperationsEndpoint(event, context);

  t.is(response.statusCode, 401);
});

test.serial('GET /async-operation/{:id} returns a 404 status code if the requested async-operation does not exist', async (t) => {
  const event = {
    headers: authHeaders,
    httpMethod: 'GET',
    pathParameters: {
      id: 'abc-123'
    }
  };

  const response = await asyncOperationsEndpoint(event, context);

  t.is(response.statusCode, 404);
});

test.serial('GET /async-operation/{:id} returns the async operation if it does exist', async (t) => {
  const event = {
    headers: authHeaders,
    httpMethod: 'GET',
    pathParameters: {
      id: randomString()
    }
  };

  await asyncOperationModel.create({
    id: event.pathParameters.id
  });

  const response = await asyncOperationsEndpoint(event, context);

  t.is(response.statusCode, 200);

  const parsedBody = JSON.parse(response.body);
  t.is(parsedBody.id, event.pathParameters.id);
});

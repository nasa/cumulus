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
const { fakeUserFactory } = require('../../lib/testUtils');

let asyncOperationModel;
let userModel;
let authHeaders;
let context;

test.before(async () => {
  // Create AsyncOperations table
  asyncOperationModel = new AsyncOperationModel({
    stackName: randomString(),
    systemBucket: randomString(),
    tableName: randomString()
  });
  await asyncOperationModel.createTable();

  // Create Users table
  process.env.UsersTable = randomString();
  userModel = new User();
  await userModel.createTable();

  const authToken = (await userModel.create(fakeUserFactory())).password;
  authHeaders = { Authorization: `Bearer ${authToken}` };

  context = {
    AsyncOperationsTable: asyncOperationModel.tableName,
    UsersTable: userModel.tableName,
    stackName: asyncOperationModel.stackName,
    systemBucket: asyncOperationModel.systemBucket
  };
});

test.after.always(async () => {
  try {
    await asyncOperationModel.deleteTable();
  }
  catch (err) {
    if (err.code !== 'ResourceNotFoundException') throw err;
  }

  try {
    await userModel.deleteTable();
  }
  catch (err) {
    if (err.code !== 'ResourceNotFoundException') throw err;
  }
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
  const asyncOperation = {
    id: 'abc-123',
    status: 'RUNNING',
    taskArn: randomString(),
    output: JSON.stringify({ age: 37 })
  };

  const createdAsyncOperation = await asyncOperationModel.create(asyncOperation);

  const event = {
    headers: authHeaders,
    httpMethod: 'GET',
    pathParameters: {
      id: createdAsyncOperation.id
    }
  };

  const response = await asyncOperationsEndpoint(event, context);

  t.is(response.statusCode, 200);

  const parsedBody = JSON.parse(response.body);

  t.deepEqual(
    parsedBody,
    {
      id: asyncOperation.id,
      status: asyncOperation.status,
      output: asyncOperation.output,
      taskArn: asyncOperation.taskArn
    }
  );
});

const test = require('ava');
const { randomString } = require('../../../api/node_modules/@cumulus/common/test-utils');
const {
  translateApiAsyncOperationToPostgresAsyncOperation,
  translatePostgresAsyncOperationToApiAsyncOperation,
} = require('../../dist/translate/async_operations');

test('translateApiAsyncOperationToPostgresAsyncOperation converts a camelCase record to snake_case', (t) => {
  const apiAsyncOperation = {
    id: '1234567890',
    status: 'RUNNING',
    taskArn: 'aws:arn:ecs:task:someTask',
    description: 'dummy operation',
    operationType: 'ES Index',
  };

  const expected = {
    id: apiAsyncOperation.id,
    status: apiAsyncOperation.status,
    task_arn: apiAsyncOperation.taskArn,
    description: apiAsyncOperation.description,
    operation_type: apiAsyncOperation.operationType,
  };

  t.deepEqual(translateApiAsyncOperationToPostgresAsyncOperation(apiAsyncOperation), expected);
});

test('translateApiAsyncOperationToPostgresAsyncOperation parses output from string to object', (t) => {
  const operationOutput = {
    esIndex: 'test-index',
    operationStatus: 'complete',
  };
  const apiAsyncOperation = {
    id: '1234567890',
    status: 'SUCCEEDED',
    taskArn: 'aws:arn:ecs:task:someTask',
    description: 'dummy operation',
    operationType: 'ES Index',
    output: JSON.parse(JSON.stringify((operationOutput))),
  };

  const expected = {
    id: apiAsyncOperation.id,
    status: apiAsyncOperation.status,
    task_arn: apiAsyncOperation.taskArn,
    description: apiAsyncOperation.description,
    operation_type: apiAsyncOperation.operationType,
    output: operationOutput,
  };

  t.deepEqual(translateApiAsyncOperationToPostgresAsyncOperation(apiAsyncOperation), expected);
});

test('translateApiAsyncOperationToPostgresAsyncOperation discards \'none\' output', (t) => {
  const apiAsyncOperation = {
    id: '1234567890',
    status: 'SUCCEEDED',
    taskArn: 'aws:arn:ecs:task:someTask',
    description: 'dummy operation',
    operationType: 'ES Index',
    output: 'none',
  };

  const expected = {
    id: apiAsyncOperation.id,
    status: apiAsyncOperation.status,
    task_arn: apiAsyncOperation.taskArn,
    description: apiAsyncOperation.description,
    operation_type: apiAsyncOperation.operationType,
  };

  t.deepEqual(translateApiAsyncOperationToPostgresAsyncOperation(apiAsyncOperation), expected);
});

test('translatePostgresAsyncOperationToApiAsyncOperation translates PostgreSQL record to async operation API record', async (t) => {
  const id = randomString();
  const taskArn = randomString();
  const createdAt = new Date();
  const updatedAt = new Date();
  const pgAsyncOperation = {
    id,
    status: 'RUNNING',
    task_arn: taskArn,
    description: 'Some async run',
    operation_type: 'ES Index',
    output: { field: 'value' },
    created_at: createdAt,
    updated_at: updatedAt,
  };

  const expectedAsyncOperation = {
    id,
    status: 'RUNNING',
    taskArn,
    description: 'Some async run',
    operationType: 'ES Index',
    output: JSON.stringify({ field: 'value' }),
    createdAt: createdAt.getTime(),
    updatedAt: updatedAt.getTime(),
  };
  const translation = await translatePostgresAsyncOperationToApiAsyncOperation(pgAsyncOperation);
  t.deepEqual(translation, expectedAsyncOperation);
});

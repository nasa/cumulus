const test = require('ava');
const { translateApiAsyncOperationToPostgresAsyncOperation } = require('../../dist/translate/async_operations');

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
    output: JSON.stringify(operationOutput),
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

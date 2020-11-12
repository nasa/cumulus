const test = require('ava');
const { translateApiAsyncOperationToPostgresAsyncOperation } = require('../dist/async_operations');

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

test('translateApiAsyncOperationToPostgresAsyncOperation does not convert output field to snake_case', (t) => {
  const apiAsyncOperation = {
    id: '1234567890',
    status: 'SUCCEEDED',
    taskArn: 'aws:arn:ecs:task:someTask',
    description: 'dummy operation',
    operationType: 'ES Index',
    output: {
      esIndex: 'test-index',
      operationStatus: 'complete',
    },
  };

  const expected = {
    id: apiAsyncOperation.id,
    status: apiAsyncOperation.status,
    task_arn: apiAsyncOperation.taskArn,
    description: apiAsyncOperation.description,
    operation_type: apiAsyncOperation.operationType,
    output: apiAsyncOperation.output,
  };

  t.deepEqual(translateApiAsyncOperationToPostgresAsyncOperation(apiAsyncOperation), expected);
});

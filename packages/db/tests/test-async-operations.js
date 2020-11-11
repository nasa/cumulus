const test = require('ava');
const { translateAsyncOperationToSnakeCase } = require('../dist/async_operations');

test('translateAsyncOperationToSnakeCase converts a camelCase record to snake_case', (t) => {
  const camelCaseAsyncOperation = {
    id: '1234567890',
    status: 'RUNNING',
    taskArn: 'aws:arn:ecs:task:someTask',
    description: 'dummy operation',
    operationType: 'ES Index',
  };

  const expected = {
    id: camelCaseAsyncOperation.id,
    status: camelCaseAsyncOperation.status,
    task_arn: camelCaseAsyncOperation.taskArn,
    description: camelCaseAsyncOperation.description,
    operation_type: camelCaseAsyncOperation.operationType,
  };

  t.deepEqual(translateAsyncOperationToSnakeCase(camelCaseAsyncOperation), expected);
});

test('translateAsyncOperationToSnakeCase does not convert output field to snake_case', (t) => {
  const camelCaseAsyncOperation = {
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
    id: camelCaseAsyncOperation.id,
    status: camelCaseAsyncOperation.status,
    task_arn: camelCaseAsyncOperation.taskArn,
    description: camelCaseAsyncOperation.description,
    operation_type: camelCaseAsyncOperation.operationType,
    output: camelCaseAsyncOperation.output,
  };

  t.deepEqual(translateAsyncOperationToSnakeCase(camelCaseAsyncOperation), expected);
});

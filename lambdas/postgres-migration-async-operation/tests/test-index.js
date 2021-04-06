const test = require('ava');
const sinon = require('sinon');
const asyncOperations = require('@cumulus/async-operations');

// eslint-disable-next-line unicorn/import-index
const { handler } = require('../dist/lambda/index');

test('handler calls startAsyncOperation with the expected parameters', async (t) => {
  const stub = sinon.stub(asyncOperations, 'startAsyncOperation').resolves(1);
  t.teardown(() => {
    stub.restore();
  });
  t.is(await handler(), 1);
  t.true(stub.calledWith({
    cluster: undefined,
    lambdaName: undefined,
    asyncOperationTaskDefinition: undefined,
    description: 'Data Migration 2 Lambda ECS Run',
    operationType: 'Data Migration',
    payload: {
    },
    stackName: undefined,
    systemBucket: undefined,
    dynamoTableName: undefined,
    knexConfig: process.env,
    useLambdaEnvironmentVariables: true,
  }));
});

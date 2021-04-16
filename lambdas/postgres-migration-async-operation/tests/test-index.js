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
  const event = {
    granuleSearchParams: {
      foo: 'bar',
    },
  };
  t.is(await handler(event), 1);
  t.true(stub.calledWith({
    cluster: undefined,
    lambdaName: undefined,
    asyncOperationTaskDefinition: undefined,
    description: 'Data Migration 2 Lambda ECS Run',
    operationType: 'Data Migration',
    payload: event,
    stackName: undefined,
    systemBucket: undefined,
    dynamoTableName: undefined,
    knexConfig: process.env,
    useLambdaEnvironmentVariables: true,
  }));
});

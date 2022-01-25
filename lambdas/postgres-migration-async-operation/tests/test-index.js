const test = require('ava');
const sinon = require('sinon');
const cryptoRandomString = require('crypto-random-string');
const asyncOperations = require('@cumulus/async-operations');

// eslint-disable-next-line unicorn/import-index
const { handler } = require('../dist/lambda/index');

test.before((t) => {
  t.context.lambdaName = `lambda${cryptoRandomString({ length: 5 })}`;
  process.env.MigrationLambda = t.context.lambdaName;
  t.context.callerLambdaName = `caller${cryptoRandomString({ length: 5 })}`;
  t.context.cluster = `cluster${cryptoRandomString({ length: 5 })}`;
  process.env.EcsCluster = t.context.cluster;
  t.context.asyncOperationTaskDefinition = `async${cryptoRandomString({ length: 5 })}`;
  process.env.AsyncOperationTaskDefinition = t.context.asyncOperationTaskDefinition;
  t.context.stackName = `stack${cryptoRandomString({ length: 5 })}`;
  process.env.stackName = t.context.stackName;
  t.context.systemBucket = `stack${cryptoRandomString({ length: 5 })}`;
  process.env.system_bucket = t.context.systemBucket;
  t.context.dynamoTableName = `table${cryptoRandomString({ length: 5 })}`;
  process.env.AsyncOperationsTable = t.context.dynamoTableName;
});

test('handler calls startAsyncOperation with the expected parameters', async (t) => {
  const {
    asyncOperationTaskDefinition,
    callerLambdaName,
    dynamoTableName,
    lambdaName,
    cluster,
    stackName,
    systemBucket,
  } = t.context;
  const stub = sinon.stub(asyncOperations, 'startAsyncOperation').resolves(1);
  t.teardown(() => {
    stub.restore();
  });
  const event = {
    granuleSearchParams: {
      foo: 'bar',
    },
  };
  t.is(await handler(event, { functionName: callerLambdaName }), 1);
  t.deepEqual(stub.getCall(0).firstArg, {
    cluster,
    callerLambdaName,
    lambdaName,
    asyncOperationTaskDefinition,
    description: 'Data Migration 2 Lambda ECS Run',
    operationType: 'Data Migration',
    payload: event,
    stackName,
    systemBucket,
    dynamoTableName,
    knexConfig: process.env,
    useLambdaEnvironmentVariables: true,
  });
});

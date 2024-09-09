const test = require('ava');
const sinon = require('sinon');
const cryptoRandomString = require('crypto-random-string');
const asyncOperations = require('@cumulus/async-operations');

// eslint-disable-next-line unicorn/import-index
const { handler } = require('../dist/lambda/index');

test.before((t) => {
  t.context.dlaMigrationLambda = `DlaMigrationLambda${cryptoRandomString({ length: 5 })}`;
  process.env.DlaMigrationLambda = t.context.dlaMigrationLambda;
  t.context.reconciliationReportMigrationLambda = `ReconciliationReportMigrationLambda${cryptoRandomString({ length: 5 })}`;
  process.env.ReconciliationReportMigrationLambda = t.context.reconciliationReportMigrationLambda;
  t.context.callerLambdaName = `caller${cryptoRandomString({ length: 5 })}`;
  t.context.cluster = `cluster${cryptoRandomString({ length: 5 })}`;
  process.env.EcsCluster = t.context.cluster;
  t.context.asyncOperationTaskDefinition = `async${cryptoRandomString({ length: 5 })}`;
  process.env.AsyncOperationTaskDefinition = t.context.asyncOperationTaskDefinition;
  t.context.stackName = `stack${cryptoRandomString({ length: 5 })}`;
  process.env.stackName = t.context.stackName;
  t.context.systemBucket = `stack${cryptoRandomString({ length: 5 })}`;
  process.env.system_bucket = t.context.systemBucket;
});

test('handler calls startAsyncOperation with the expected parameters for DLA Migration', async (t) => {
  const {
    asyncOperationTaskDefinition,
    callerLambdaName,
    dlaMigrationLambda,
    cluster,
    stackName,
    systemBucket,
  } = t.context;
  const stub = sinon.stub(asyncOperations, 'startAsyncOperation').resolves(1);
  t.teardown(() => {
    stub.restore();
  });
  const event = {
    operationType: 'DLA Migration',
    foo: 'bar',
  };
  t.is(await handler(event, { functionName: callerLambdaName }), 1);
  t.deepEqual(stub.getCall(0).firstArg, {
    cluster,
    callerLambdaName,
    dlaMigrationLambda,
    asyncOperationTaskDefinition,
    description: 'Migrate Dead Letter Archive Messages',
    operationType: 'DLA Migration',
    payload: event,
    stackName,
    systemBucket,
    knexConfig: process.env,
    useLambdaEnvironmentVariables: true,
  });
});

test('handler calls startAsyncOperation with the expected parameters ReconciliationReport Migration', async (t) => {
  const {
    asyncOperationTaskDefinition,
    callerLambdaName,
    reconciliationReportMigrationLambda,
    cluster,
    stackName,
    systemBucket,
  } = t.context;
  const stub = sinon.stub(asyncOperations, 'startAsyncOperation').resolves(1);
  t.teardown(() => {
    stub.restore();
  });
  const event = {
    operationType: 'ReconciliationReport Migration',
    foo: 'bar',
  };
  t.is(await handler(event, { functionName: callerLambdaName }), 1);
  t.deepEqual(stub.getCall(0).firstArg, {
    cluster,
    callerLambdaName,
    reconciliationReportMigrationLambda,
    asyncOperationTaskDefinition,
    description: 'Migrate Reconciliation Reports',
    operationType: 'ReconciliationReport Migration',
    payload: event,
    stackName,
    systemBucket,
    knexConfig: process.env,
    useLambdaEnvironmentVariables: true,
  });
});

test('handler throws error if the operationType is not support', async (t) => {
  const operationType = 'Unsupported Operation';
  const {
    callerLambdaName,
  } = t.context;
  const event = {
    operationType,
    foo: 'bar',
  };
  await t.throwsAsync(
    handler(event, { functionName: callerLambdaName }),
    { message: `${operationType} is not supported` }
  );
});

'use strict';

const cryptoRandomString = require('crypto-random-string');

const isString = require('lodash/isString');
const test = require('ava');
const sinon = require('sinon');

const { ecs, lambda, s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const { EcsStartTaskError } = require('@cumulus/errors');
const {
  localStackConnectionEnv, createTestDatabase, deleteTestDatabase, getKnexClient
} = require('@cumulus/db');

const { AsyncOperation } = require('@cumulus/api/models');
const { getLambdaEnvironmentVariables, start } = require('../dist/async_operations');

// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../../lambdas/db-migration');

let asyncOperationModel;
let stubbedEcsRunTaskParams;
let stubbedEcsRunTaskResult;

let ecsClient;
let systemBucket;

const testDbName = `async_operation_model_test_db_${cryptoRandomString({ length: 10 })}`;
const knexConfig = {
  ...localStackConnectionEnv,
  PG_DATABASE: testDbName,
};

test.before(async (t) => {
  console.log(testDbName);
  t.context.knexAdmin = await getKnexClient({ env: localStackConnectionEnv });
  t.context.knex = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      PG_DATABASE: testDbName,
      migrationDir,
    },
  });
  systemBucket = randomString();
  await s3().createBucket({ Bucket: systemBucket }).promise();

  asyncOperationModel = new AsyncOperation({
    systemBucket,
    stackName: randomString(),
    tableName: randomString(),
  });

  try {
    await asyncOperationModel.createTable();
    await createTestDatabase(t.context.knexAdmin, testDbName, localStackConnectionEnv.PG_USER);
    await t.context.knex.migrate.latest();
    await t.context.knex.destroy();
  } catch (e) {
    console.log(`Error ${JSON.stringify(e)}`);
    throw (e);
  }

  // Set up the mock ECS client
  ecsClient = ecs();
  ecsClient.runTask = (params) => {
    stubbedEcsRunTaskParams = params;
    return {
      promise: () => {
        if (!stubbedEcsRunTaskResult) return Promise.reject(new Error('stubbedEcsRunTaskResult has not yet been set'));
        return Promise.resolve(stubbedEcsRunTaskResult);
      },
    };
  };

  sinon.stub(lambda(), 'getFunctionConfiguration').returns({
    promise: () => Promise.resolve({
      Environment: {
        Variables: {
          ES_HOST: 'es-host',
          AsyncOperationsTable: 'async-operations-table',
        },
      },
    }),
  });
});

test.after.always(async (t) => {
  sinon.restore();
  await asyncOperationModel.deleteTable();
  await recursivelyDeleteS3Bucket(systemBucket);
  //await deleteTestDatabase(t.context.knexAdmin, testDbName);
  console.log(testDbName);
  await t.context.knexAdmin.destroy();
});

test.serial('async_operations start uploads the payload to S3', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: [],
  };
  const payload = { number: 42 };
  const stackName = randomString();

  const { id } = await start({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload,
    stackName,
    dynamoTableName: asyncOperationModel.tableName,
    knexConfig: knexConfig,
    systemBucket,
  });

  const getObjectResponse = await s3().getObject({
    Bucket: systemBucket,
    Key: `${stackName}/async-operation-payloads/${id}.json`,
  }).promise();

  t.deepEqual(JSON.parse(getObjectResponse.Body.toString()), payload);
});

test.serial('The AsyncOperation start method starts an ECS task with the correct parameters', async (t) => {
  stubbedEcsRunTaskParams = {};
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: [],
  };

  const asyncOperationTaskDefinition = randomString();
  const cluster = randomString();
  const lambdaName = randomString();
  const payload = { x: randomString() };
  const stackName = randomString(); // shouldn't we just use the name from the model?

  const { id } = await start({
    asyncOperationTaskDefinition,
    cluster,
    lambdaName,
    description: randomString(),
    operationType: 'ES Index',
    payload,
    stackName,
    dynamoTableName: asyncOperationModel.tableName,
    knexConfig: knexConfig,
    systemBucket,
    useLambdaEnvironmentVariables: true, // Why did this work before, wtf.
  });

  t.is(stubbedEcsRunTaskParams.cluster, cluster);
  t.is(stubbedEcsRunTaskParams.taskDefinition, asyncOperationTaskDefinition);
  t.is(stubbedEcsRunTaskParams.launchType, 'EC2');

  const environmentOverrides = {};
  stubbedEcsRunTaskParams.overrides.containerOverrides[0].environment.forEach((env) => {
    environmentOverrides[env.name] = env.value;
  });

  t.is(environmentOverrides.asyncOperationId, id);
  t.is(environmentOverrides.asyncOperationsTable, asyncOperationModel.tableName);
  t.is(environmentOverrides.lambdaName, lambdaName);
  t.is(environmentOverrides.payloadUrl, `s3://${systemBucket}/${stackName}/async-operation-payloads/${id}.json`);
});

test('The AsyncOperation.start() method throws error and updates operation if it is unable to create an ECS task', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [],
    failures: [{ arn: randomString(), reason: 'out of cheese' }],
  };
  const stackName = randomString();

  await t.throwsAsync(start({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload: {},
    stackName,
    dynamoTableName: asyncOperationModel.tableName,
    knexConfig: knexConfig,
    systemBucket,
  }), {
    instanceOf: EcsStartTaskError,
    message: 'Failed to start AsyncOperation: out of cheese',
  });
});

test.serial('The AsyncOperation start() method writes a new record to DynamoDB', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: [],
  };
  const stackName = randomString();

  const { id } = await start({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload: {},
    stackName,
    dynamoTableName: asyncOperationModel.tableName,
    knexConfig: knexConfig,
    systemBucket,

  });

  const fetchedAsyncOperation = await asyncOperationModel.get({ id });
  t.is(fetchedAsyncOperation.taskArn, stubbedEcsRunTaskResult.tasks[0].taskArn);
});

test.serial('The AsyncOperation start() method returns an item id', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: [],
  };

  const stackName = randomString();

  const { id } = await start({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload: {},
    stackName,
    dynamoTableName: asyncOperationModel.tableName,
    knexConfig: knexConfig,
    systemBucket,
  });

  t.true(isString(id));
});

test.serial('The AsyncOperation.start() method sets the record status to "RUNNING"', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: [],
  };
  const stackName = randomString();

  const { id } = await start({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload: {},
    stackName,
    dynamoTableName: asyncOperationModel.tableName,
    knexConfig: knexConfig,
    systemBucket,
  });

  const fetchedAsyncOperation = await asyncOperationModel.get({ id });
  t.is(fetchedAsyncOperation.status, 'RUNNING');
});

test.serial('The AsyncOperation.start() method returns the newly-generated record', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: [],
  };

  const stackName = randomString();

  const { taskArn } = await start({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload: {},
    stackName,
    dynamoTableName: asyncOperationModel.tableName,
    knexConfig: knexConfig,
    systemBucket,
  });

  t.is(taskArn, stubbedEcsRunTaskResult.tasks[0].taskArn);
});

test('getLambdaEnvironmentVariables returns expected environment variables', async (t) => {
  const vars = await getLambdaEnvironmentVariables('name');

  t.deepEqual(new Set(vars), new Set([
    { name: 'ES_HOST', value: 'es-host' },
    { name: 'AsyncOperationsTable', value: 'async-operations-table' },
  ]));
});

test.serial('ECS task params contain lambda environment variables when flag is set', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: [],
  };

  const stackName = randomString();

  await start({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload: {},
    useLambdaEnvironmentVariables: true,
    stackName,
    dynamoTableName: asyncOperationModel.tableName,
    knexConfig: knexConfig,
    systemBucket,
  });

  const environmentOverrides = {};
  stubbedEcsRunTaskParams.overrides.containerOverrides[0].environment.forEach((env) => {
    environmentOverrides[env.name] = env.value;
  });

  t.is(environmentOverrides.ES_HOST, 'es-host');
  t.is(environmentOverrides.AsyncOperationsTable, 'async-operations-table');
});

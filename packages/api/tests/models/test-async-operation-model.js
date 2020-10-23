'use strict';

const cryptoRandomString = require('crypto-random-string');

const isString = require('lodash/isString');
const test = require('ava');
const sinon = require('sinon');

const { ecs, lambda, s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const { EcsStartTaskError } = require('@cumulus/errors');
const { localStackConnectionEnv, createTestDatabase, deleteTestDatabase, getKnexClient } = require('@cumulus/db');

const { AsyncOperation } = require('../../models');

//const migrationDir = '../../lambdas/db-migration/src/migrations';
//const migrationDir = 'lambdas/db-migration/src/migrations';
const { migrationDir } = require('../../../../lambdas/db-migration');

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
    knexConfig,
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

test('The AsyncOperation constructor requires that stackName be specified', (t) => {
  try {
    new AsyncOperation({
      systemBucket: 'asdf',
      tableName: 'asdf',
      knexConfig,
    });
    t.fail('stackName should be required');
  } catch (error) {
    t.true(error instanceof TypeError);
    t.is(error.message, 'stackName is required');
  }
});

test('The AsyncOperation constructor requires that systemBucket be specified', (t) => {
  try {
    new AsyncOperation({
      stackName: 'asdf',
      tableName: 'asdf',
      knexConfig,
    });
    t.fail('systemBucket should be required');
  } catch (error) {
    t.true(error instanceof TypeError);
    t.is(error.message, 'systemBucket is required');
  }
});

test('The AsyncOperation constructor sets the stackName', (t) => {
  const thisTestStackName = randomString();
  const asyncOperation = new AsyncOperation({
    stackName: thisTestStackName,
    systemBucket: randomString(),
    tableName: randomString,
    localStackConnectionEnv: knexConfig,
  });

  t.is(asyncOperation.stackName, thisTestStackName);
});

test('The AsyncOperation constructor sets the systemBucket', (t) => {
  const localAsyncOperationModel = new AsyncOperation({
    stackName: randomString(),
    systemBucket,
    tableName: randomString,
    localStackConnectionEnv: knexConfig,
  });

  t.is(localAsyncOperationModel.systemBucket, systemBucket);
});

test.serial('The AsyncOperation.start() method uploads the payload to S3', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: [],
  };

  const payload = { number: 42 };

  const { id } = await asyncOperationModel.start({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload,
  });

  const getObjectResponse = await s3().getObject({
    Bucket: systemBucket,
    Key: `${asyncOperationModel.stackName}/async-operation-payloads/${id}.json`,
  }).promise();

  t.deepEqual(JSON.parse(getObjectResponse.Body.toString()), payload);
});

test.serial('The AsyncOperation.start() method starts an ECS task with the correct parameters', async (t) => {
  stubbedEcsRunTaskParams = {};
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: [],
  };

  const asyncOperationTaskDefinition = randomString();
  const cluster = randomString();
  const lambdaName = randomString();
  const payload = { x: randomString() };

  const { id } = await asyncOperationModel.start({
    asyncOperationTaskDefinition,
    cluster,
    lambdaName,
    description: randomString(),
    operationType: 'ES Index',
    payload,
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
  t.is(environmentOverrides.payloadUrl, `s3://${systemBucket}/${asyncOperationModel.stackName}/async-operation-payloads/${id}.json`);
});

test('The AsyncOperation.start() method throws error and updates operation if it is unable to create an ECS task', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [],
    failures: [{ arn: randomString(), reason: 'out of cheese' }],
  };

  await t.throwsAsync(asyncOperationModel.start({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload: {},
  }), {
    instanceOf: EcsStartTaskError,
    message: 'Failed to start AsyncOperation: out of cheese',
  });
});

test.serial('The AsyncOperation.start() method writes a new record to DynamoDB', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: [],
  };

  const { id } = await asyncOperationModel.start({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload: {},
  });

  const fetchedAsyncOperation = await asyncOperationModel.get({ id });
  t.is(fetchedAsyncOperation.taskArn, stubbedEcsRunTaskResult.tasks[0].taskArn);
});

test.serial('The AsyncOperation.start() method returns an item id', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: [],
  };

  const { id } = await asyncOperationModel.start({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload: {},
  });

  t.true(isString(id));
});

test.serial('The AsyncOperation.start() method sets the record status to "RUNNING"', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: [],
  };

  const { id } = await asyncOperationModel.start({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload: {},
  });

  const fetchedAsyncOperation = await asyncOperationModel.get({ id });
  t.is(fetchedAsyncOperation.status, 'RUNNING');
});

test.serial('The AsyncOperation.start() method returns the newly-generated record', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: [],
  };

  const { taskArn } = await asyncOperationModel.start({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload: {},
  });

  t.is(taskArn, stubbedEcsRunTaskResult.tasks[0].taskArn);
});

test('getLambdaEnvironmentVariables returns formatted environment variables', async (t) => {
  const vars = await asyncOperationModel.getLambdaEnvironmentVariables('name');

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

  await asyncOperationModel.start({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload: {},
    useLambdaEnvironmentVariables: true,
  });

  const environmentOverrides = {};
  stubbedEcsRunTaskParams.overrides.containerOverrides[0].environment.forEach((env) => {
    environmentOverrides[env.name] = env.value;
  });

  t.is(environmentOverrides.ES_HOST, 'es-host');
  t.is(environmentOverrides.AsyncOperationsTable, 'async-operations-table');
});

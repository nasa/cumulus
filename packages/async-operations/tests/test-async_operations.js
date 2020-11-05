'use strict';

const cryptoRandomString = require('crypto-random-string');

const test = require('ava');
const sinon = require('sinon');

const omit = require('lodash/omit');
const { ecs, lambda, s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
// eslint-disable-next-line node/no-unpublished-require
const { randomString } = require('@cumulus/common/test-utils');
const {
  localStackConnectionEnv, createTestDatabase, deleteTestDatabase, getKnexClient,
} = require('@cumulus/db');
const { EcsStartTaskError } = require('@cumulus/errors');

// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../../lambdas/db-migration');

const { getLambdaEnvironmentVariables, startAsyncOperation } = require('../dist/async_operations');

const dynamoTableName = 'notUsedDynamoTableName';

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
  await createTestDatabase(t.context.knexAdmin, testDbName, localStackConnectionEnv.PG_USER);
  await t.context.knex.migrate.latest();

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
  await t.context.knex.destroy();
  await recursivelyDeleteS3Bucket(systemBucket);
  await deleteTestDatabase(t.context.knexAdmin, testDbName);
  await t.context.knexAdmin.destroy();
});

test.serial('startAsyncOperation uploads the payload to S3', async (t) => {
  const createSpy = sinon.spy((obj) => obj);
  const stubbedAsyncOperationsModel = class {
    create = createSpy;
  };

  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: [],
  };
  const payload = { number: 42 };
  const stackName = randomString();

  const { id } = await startAsyncOperation({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload,
    stackName,
    dynamoTableName: dynamoTableName,
    knexConfig: knexConfig,
    systemBucket,
  }, stubbedAsyncOperationsModel);

  const getObjectResponse = await s3().getObject({
    Bucket: systemBucket,
    Key: `${stackName}/async-operation-payloads/${id}.json`,
  }).promise();

  t.deepEqual(JSON.parse(getObjectResponse.Body.toString()), payload);
});

test.serial('The AsyncOperation start method starts an ECS task with the correct parameters', async (t) => {
  const createSpy = sinon.spy((obj) => obj);
  const stubbedAsyncOperationsModel = class {
    create = createSpy;
  };

  stubbedEcsRunTaskParams = {};
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: [],
  };

  const asyncOperationTaskDefinition = randomString();
  const cluster = randomString();
  const lambdaName = randomString();
  const payload = { x: randomString() };
  const stackName = randomString();

  const { id } = await startAsyncOperation({
    asyncOperationTaskDefinition,
    cluster,
    lambdaName,
    description: randomString(),
    operationType: 'ES Index',
    payload,
    stackName,
    dynamoTableName: dynamoTableName,
    knexConfig: knexConfig,
    systemBucket,
    useLambdaEnvironmentVariables: true,
  }, stubbedAsyncOperationsModel);

  t.is(stubbedEcsRunTaskParams.cluster, cluster);
  t.is(stubbedEcsRunTaskParams.taskDefinition, asyncOperationTaskDefinition);
  t.is(stubbedEcsRunTaskParams.launchType, 'EC2');

  const environmentOverrides = {};
  stubbedEcsRunTaskParams.overrides.containerOverrides[0].environment.forEach((env) => {
    environmentOverrides[env.name] = env.value;
  });

  t.is(environmentOverrides.asyncOperationId, id);
  t.is(environmentOverrides.asyncOperationsTable, dynamoTableName);
  t.is(environmentOverrides.lambdaName, lambdaName);
  t.is(environmentOverrides.payloadUrl, `s3://${systemBucket}/${stackName}/async-operation-payloads/${id}.json`);
});

test.serial('The startAsyncOperation method throws error if it is unable to create an ECS task', async (t) => {
  const createSpy = sinon.spy((obj) => ({ id: obj.id }));
  const stubbedAsyncOperationsModel = class {
    create = createSpy;
  };

  stubbedEcsRunTaskResult = {
    tasks: [],
    failures: [{ arn: randomString(), reason: 'out of cheese' }],
  };
  const stackName = randomString();

  await t.throwsAsync(startAsyncOperation({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload: {},
    stackName,
    dynamoTableName: dynamoTableName,
    knexConfig: knexConfig,
    systemBucket,
  }, stubbedAsyncOperationsModel), {
    instanceOf: EcsStartTaskError,
    message: 'Failed to start AsyncOperation: out of cheese',
  });
});

test('startAsyncOperation calls Dynamo model create method', async (t) => {
  const createSpy = sinon.spy(() => true);
  const stubbedAsyncOperationsModel = class {
    create = createSpy;
  };
  const stackName = randomString();
  const description = randomString();
  const taskArn = randomString();

  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn }],
    failures: [],
  };
  const result = await startAsyncOperation({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    description,
    operationType: 'ES Index',
    payload: {},
    stackName,
    dynamoTableName: dynamoTableName,
    knexConfig: knexConfig,
    systemBucket,
  }, stubbedAsyncOperationsModel);

  const spyCall = createSpy.getCall(0).args[0];

  const expected = {
    description,
    operationType: 'ES Index',
    status: 'RUNNING',
    taskArn,
  };

  t.true(result);
  t.deepEqual(omit(spyCall, ['id']), expected);
  t.truthy(spyCall.id);
});

test.serial('The startAsyncOperation writes records to the databases', async (t) => {
  const createSpy = sinon.spy((obj) => ({ id: obj.id }));
  const stubbedAsyncOperationsModel = class {
    create = createSpy;
  };
  const description = randomString();
  const stackName = randomString();
  const operationType = 'ES Index';
  const taskArn = randomString();

  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn }],
    failures: [],
  };

  const { id } = await startAsyncOperation({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    description,
    operationType,
    payload: {},
    stackName,
    dynamoTableName: dynamoTableName,
    knexConfig: knexConfig,
    systemBucket,
  }, stubbedAsyncOperationsModel);

  const spyCall = createSpy.getCall(0).args[0];
  const dbResults = await t.context.knex.select('*')
    .from('asyncOperations')
    .where('id', id)
    .first();
  const expected = {
    cumulusId: 1,
    description,
    id,
    operationType: 'ES Index',
    status: 'RUNNING',
    taskArn,
  };
  const omitList = ['created_at', 'updated_at', 'cumulusId', 'output'];
  t.deepEqual(omit(dbResults[0], omitList), omit(expected[0], omitList));
  t.deepEqual(omit(spyCall, omitList), omit(expected, omitList));
});

test.serial('The startAsyncOperation method returns the newly-generated record', async (t) => {
  const createSpy = sinon.spy((obj) => obj);
  const stubbedAsyncOperationsModel = class {
    create = createSpy;
  };

  const taskArn = randomString();
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn }],
    failures: [],
  };

  const stackName = randomString();

  const results = await startAsyncOperation({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload: {},
    stackName,
    dynamoTableName: dynamoTableName,
    knexConfig: knexConfig,
    systemBucket,
  }, stubbedAsyncOperationsModel);

  t.is(results.taskArn, taskArn);
});

test('getLambdaEnvironmentVariables returns expected environment variables', async (t) => {
  const vars = await getLambdaEnvironmentVariables('name');

  t.deepEqual(new Set(vars), new Set([
    { name: 'ES_HOST', value: 'es-host' },
    { name: 'AsyncOperationsTable', value: 'async-operations-table' },
  ]));
});

test.serial('ECS task params contain lambda environment variables when useLambdaEnvironmentVariables is set to true', async (t) => {
  const createSpy = sinon.spy((obj) => obj);
  const stubbedAsyncOperationsModel = class {
    create = createSpy;
  };

  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: [],
  };

  const stackName = randomString();

  await startAsyncOperation({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload: {},
    useLambdaEnvironmentVariables: true,
    stackName,
    dynamoTableName: dynamoTableName,
    knexConfig: knexConfig,
    systemBucket,
  }, stubbedAsyncOperationsModel);

  const environmentOverrides = {};
  stubbedEcsRunTaskParams.overrides.containerOverrides[0].environment.forEach((env) => {
    environmentOverrides[env.name] = env.value;
  });

  t.is(environmentOverrides.ES_HOST, 'es-host');
  t.is(environmentOverrides.AsyncOperationsTable, 'async-operations-table');
});

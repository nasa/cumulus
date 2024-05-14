'use strict';

const cryptoRandomString = require('crypto-random-string');

const test = require('ava');
const sinon = require('sinon');
const omit = require('lodash/omit');

const { v4: uuidv4 } = require('uuid');
const { mockClient } = require('aws-sdk-client-mock');
const { GetFunctionConfigurationCommand } = require('@aws-sdk/client-lambda');

const { ecs, lambda, s3 } = require('@cumulus/aws-client/services');
const { getJsonS3Object, recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
// eslint-disable-next-line node/no-unpublished-require
const { randomString } = require('@cumulus/common/test-utils');
const {
  localStackConnectionEnv,
  translateApiAsyncOperationToPostgresAsyncOperation,
  generateLocalTestDb,
  destroyLocalTestDb,
  AsyncOperationPgModel,
  migrationDir,
} = require('@cumulus/db');
const { EcsStartTaskError, MissingRequiredArgument } = require('@cumulus/errors');
const { Search } = require('@cumulus/es-client/search');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');
const {
  getLambdaConfiguration,
  getLambdaEnvironmentVariables,
  createAsyncOperation,
  startAsyncOperation,
} = require('../dist/async_operations');

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
  process.env = { ...process.env, ...localStackConnectionEnv, PG_DATABASE: testDbName };
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;

  systemBucket = randomString();
  await s3().createBucket({ Bucket: systemBucket });

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.esAsyncOperationsClient = new Search(
    {},
    'asyncOperation',
    t.context.esIndex
  );

  // Set up the mock ECS client
  ecsClient = ecs();
  ecsClient.runTask = (params) => {
    stubbedEcsRunTaskParams = params;
    if (!stubbedEcsRunTaskResult) return Promise.reject(new Error('stubbedEcsRunTaskResult has not yet been set'));
    return Promise.resolve(stubbedEcsRunTaskResult);
  };

  t.context.functionConfig = {
    Environment: {
      Variables: {
        ES_HOST: 'es-host',
      },
    },
  };

  const mockLambdaClient = mockClient(lambda()).onAnyCommand().rejects();
  mockLambdaClient.on(GetFunctionConfigurationCommand).resolves(
    Promise.resolve(t.context.functionConfig)
  );
  t.context.asyncOperationPgModel = new AsyncOperationPgModel();
});

test.beforeEach((t) => {
  t.context.id = uuidv4();
  t.context.createObject = {
    id: t.context.id,
    status: 'RUNNING',
    taskArn: cryptoRandomString({ length: 5 }),
    description: 'testing',
    operationType: 'ES Index',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
});

test.after.always(async (t) => {
  sinon.restore();
  await recursivelyDeleteS3Bucket(systemBucket);
  await cleanupTestIndex(t.context);
  await destroyLocalTestDb({
    knex: t.context.testKnex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
  });
});

test.serial('startAsyncOperation uploads the payload to S3', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: [],
  };
  const payload = { number: 42 };
  const stackName = randomString();

  const { id } = await startAsyncOperation({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    callerLambdaName: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload,
    stackName,
    knexConfig: knexConfig,
    systemBucket,
  });

  const payloadObjectData = await getJsonS3Object(systemBucket, `${stackName}/async-operation-payloads/${id}.json`);
  t.deepEqual(payloadObjectData, payload);
});

test.serial('The AsyncOperation start method starts an ECS task with the correct parameters', async (t) => {
  stubbedEcsRunTaskParams = {};
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: [],
  };

  const asyncOperationTaskDefinition = randomString();
  const cluster = randomString();
  const callerLambdaName = randomString();
  const lambdaName = randomString();
  const payload = { x: randomString() };
  const stackName = randomString();

  const { id } = await startAsyncOperation({
    asyncOperationTaskDefinition,
    cluster,
    lambdaName,
    callerLambdaName,
    description: randomString(),
    operationType: 'ES Index',
    payload,
    stackName,
    knexConfig: knexConfig,
    systemBucket,
    useLambdaEnvironmentVariables: true,
  });

  t.is(stubbedEcsRunTaskParams.cluster, cluster);
  t.is(stubbedEcsRunTaskParams.taskDefinition, asyncOperationTaskDefinition);
  t.is(stubbedEcsRunTaskParams.launchType, 'FARGATE');

  const environmentOverrides = {};
  stubbedEcsRunTaskParams.overrides.containerOverrides[0].environment.forEach((env) => {
    environmentOverrides[env.name] = env.value;
  });

  t.is(environmentOverrides.asyncOperationId, id);
  t.is(environmentOverrides.lambdaName, lambdaName);
  t.is(environmentOverrides.payloadUrl, `s3://${systemBucket}/${stackName}/async-operation-payloads/${id}.json`);
});

test.serial('The AsyncOperation start method starts an ECS task with the asyncOperationId passed in', async (t) => {
  t.true(Math.random() > 0.1);
  stubbedEcsRunTaskParams = {};
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: [],
  };

  const asyncOperationId = uuidv4();
  const asyncOperationTaskDefinition = randomString();
  const cluster = randomString();
  const callerLambdaName = randomString();
  const lambdaName = randomString();
  const payload = { x: randomString() };
  const stackName = randomString();

  const { id } = await startAsyncOperation({
    asyncOperationId,
    asyncOperationTaskDefinition,
    cluster,
    lambdaName,
    callerLambdaName,
    description: randomString(),
    operationType: 'ES Index',
    payload,
    stackName,
    knexConfig: knexConfig,
    systemBucket,
    useLambdaEnvironmentVariables: true,
  });

  t.is(stubbedEcsRunTaskParams.cluster, cluster);
  t.is(stubbedEcsRunTaskParams.taskDefinition, asyncOperationTaskDefinition);
  t.is(stubbedEcsRunTaskParams.launchType, 'FARGATE');

  const environmentOverrides = {};
  stubbedEcsRunTaskParams.overrides.containerOverrides[0].environment.forEach((env) => {
    environmentOverrides[env.name] = env.value;
  });

  t.is(id, asyncOperationId);
  t.is(environmentOverrides.asyncOperationId, asyncOperationId);
  t.is(environmentOverrides.lambdaName, lambdaName);
  t.is(environmentOverrides.payloadUrl, `s3://${systemBucket}/${stackName}/async-operation-payloads/${asyncOperationId}.json`);
});

test.serial('The startAsyncOperation method throws error and calls createAsyncOperation when unable to start ECS task', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [],
    failures: [{ arn: randomString(), reason: 'out of cheese' }],
  };

  const asyncOperationId = uuidv4();
  const asyncOperationParams = {
    asyncOperationId,
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    callerLambdaName: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload: {},
    stackName: randomString(),
    knexConfig: knexConfig,
    systemBucket,
  };
  const expectedErrorThrown = {
    instanceOf: EcsStartTaskError,
    message: 'Failed to start AsyncOperation: out of cheese',
  };
  await t.throwsAsync(
    startAsyncOperation(asyncOperationParams),
    expectedErrorThrown
  );

  const asyncOperationPgRecord = await t.context.asyncOperationPgModel.get(
    t.context.testKnex,
    { id: asyncOperationId }
  );

  const expected = {
    id: asyncOperationParams.asyncOperationId,
    description: asyncOperationParams.description,
    operationType: asyncOperationParams.operationType,
    status: 'RUNNER_FAILED',
    task_arn: null,
  };

  const omitList = ['created_at', 'updated_at', 'cumulus_id', 'output'];
  t.deepEqual(
    omit(asyncOperationPgRecord, omitList),
    translateApiAsyncOperationToPostgresAsyncOperation(omit(expected, omitList))
  );
});

test('The startAsyncOperation writes records to all data stores', async (t) => {
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
    callerLambdaName: randomString(),
    lambdaName: randomString(),
    description,
    operationType,
    payload: {},
    stackName,
    knexConfig: knexConfig,
    systemBucket,
  });

  const asyncOperationPgRecord = await t.context.asyncOperationPgModel.get(
    t.context.testKnex,
    { id }
  );
  const expected = {
    description,
    id,
    operationType: 'ES Index',
    status: 'RUNNING',
    taskArn,
  };
  const omitList = ['created_at', 'updated_at', 'cumulus_id', 'output'];
  t.deepEqual(
    omit(asyncOperationPgRecord, omitList),
    translateApiAsyncOperationToPostgresAsyncOperation(omit(expected, omitList))
  );
  const esRecord = await t.context.esAsyncOperationsClient.get(id);
  t.deepEqual(
    await t.context.esAsyncOperationsClient.get(id),
    {
      ...expected,
      _id: esRecord._id,
      timestamp: esRecord.timestamp,
      updatedAt: esRecord.updatedAt,
      createdAt: esRecord.createdAt,
    }
  );
});

test.serial('The startAsyncOperation writes records with correct timestamps', async (t) => {
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
    callerLambdaName: randomString(),
    lambdaName: randomString(),
    description,
    operationType,
    payload: {},
    stackName,
    knexConfig: knexConfig,
    systemBucket,
  });

  const asyncOperationPgRecord = await t.context.asyncOperationPgModel.get(
    t.context.testKnex,
    { id }
  );

  const esRecord = await t.context.esAsyncOperationsClient.get(id);
  t.is(asyncOperationPgRecord.created_at.getTime(), esRecord.createdAt);
  t.is(asyncOperationPgRecord.updated_at.getTime(), esRecord.updatedAt);
});

test.serial('The startAsyncOperation method returns the newly-generated record', async (t) => {
  const taskArn = randomString();
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn }],
    failures: [],
  };

  const stackName = randomString();

  const results = await startAsyncOperation({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    callerLambdaName: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload: {},
    stackName,
    knexConfig: knexConfig,
    systemBucket,
  });

  t.is(results.taskArn, taskArn);
});

test.serial('The startAsyncOperation method throws error if callerLambdaName parameter is missing', async (t) => {
  stubbedEcsRunTaskParams = {};
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: [],
  };

  await t.throwsAsync(
    startAsyncOperation({
      asyncOperationTaskDefinition: randomString(),
      cluster: randomString,
      lambdaName: randomString,
      description: randomString(),
      operationType: 'ES Index',
      payload: { x: randomString() },
      stackName: randomString,
      knexConfig: knexConfig,
      systemBucket,
      useLambdaEnvironmentVariables: true,
    }),
    { instanceOf: MissingRequiredArgument }
  );
});

test('getLambdaConfiguration returns expected configuration', async (t) => {
  const config = await getLambdaConfiguration('name');
  t.deepEqual(config, t.context.functionConfig);
});

test('getLambdaEnvironmentVariables returns expected environment variables', (t) => {
  const vars = getLambdaEnvironmentVariables(t.context.functionConfig);

  t.deepEqual(new Set(vars), new Set([
    { name: 'ES_HOST', value: 'es-host' },
  ]));
});

test.serial('ECS task params contain lambda environment variables when useLambdaEnvironmentVariables is set to true', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: [],
  };

  const stackName = randomString();

  await startAsyncOperation({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    callerLambdaName: randomString(),
    lambdaName: randomString(),
    description: randomString(),
    operationType: 'ES Index',
    payload: {},
    useLambdaEnvironmentVariables: true,
    stackName,
    knexConfig: knexConfig,
    systemBucket,
  });

  const environmentOverrides = {};
  stubbedEcsRunTaskParams.overrides.containerOverrides[0].environment.forEach((env) => {
    environmentOverrides[env.name] = env.value;
  });

  t.is(environmentOverrides.ES_HOST, 'es-host');
});

test.serial('createAsyncOperation throws if stackName is not provided', async (t) => {
  const { createObject } = t.context;

  const fakeAsyncOpPgModel = {
    create: () => {
      throw new Error('something bad');
    },
  };

  const createParams = {
    knex: t.context.testKnex,
    asyncOperationPgModel: fakeAsyncOpPgModel,
    createObject,
    systemBucket: 'FakeBucket',
  };
  await t.throwsAsync(
    createAsyncOperation(createParams),
    { name: 'TypeError' }
  );
});

test('createAsyncOperation throws if systemBucket is not provided', async (t) => {
  const { createObject } = t.context;

  const fakeAsyncOpPgModel = {
    create: () => {
      throw new Error('something bad');
    },
  };

  const createParams = {
    knex: t.context.testKnex,
    asyncOperationPgModel: fakeAsyncOpPgModel,
    createObject,
    stackName: 'fakeStack',
  };
  await t.throwsAsync(
    createAsyncOperation(createParams),
    { name: 'TypeError' }
  );
});

test.serial('createAsyncOperation() does not write to Elasticsearch if writing to PostgreSQL fails', async (t) => {
  const { id, createObject } = t.context;

  const fakeAsyncOpPgModel = {
    create: () => {
      throw new Error('something bad');
    },
  };

  const createParams = {
    knex: t.context.testKnex,
    asyncOperationPgModel: fakeAsyncOpPgModel,
    createObject,
    stackName: 'FakeStack',
    systemBucket: 'FakeBucket',
  };
  await t.throwsAsync(
    createAsyncOperation(createParams),
    { message: 'something bad' }
  );

  const dbRecords = await t.context.asyncOperationPgModel
    .search(t.context.testKnex, { id });
  t.is(dbRecords.length, 0);
  t.false(await t.context.esAsyncOperationsClient.exists(
    id
  ));
});

test.serial('createAsyncOperation() does not write to PostgreSQL if writing to Elasticsearch fails', async (t) => {
  const { id, createObject } = t.context;
  const fakeEsClient = {
    initializeEsClient: () => Promise.resolve(),
    client: {
      index: () => {
        throw new Error('ES something bad');
      },
    },
  };

  const createParams = {
    knex: t.context.testKnex,
    createObject,
    esClient: fakeEsClient,
    stackName: 'FakeStack',
    systemBucket: 'FakeBucket',
  };
  await t.throwsAsync(
    createAsyncOperation(createParams),
    { message: 'ES something bad' }
  );

  const dbRecords = await t.context.asyncOperationPgModel
    .search(t.context.testKnex, { id });
  t.is(dbRecords.length, 0);
  t.false(await t.context.esAsyncOperationsClient.exists(
    id
  ));
});

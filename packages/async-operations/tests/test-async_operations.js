'use strict';

const cryptoRandomString = require('crypto-random-string');

const test = require('ava');
const sinon = require('sinon');
const omit = require('lodash/omit');

const { v4: uuidv4 } = require('uuid');
const { ecs, lambda, s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
// eslint-disable-next-line node/no-unpublished-require
const { randomString } = require('@cumulus/common/test-utils');
const {
  localStackConnectionEnv,
  translateApiAsyncOperationToPostgresAsyncOperation,
  generateLocalTestDb,
  destroyLocalTestDb,
  AsyncOperationPgModel,
} = require('@cumulus/db');
const { EcsStartTaskError } = require('@cumulus/errors');
const { Search } = require('@cumulus/es-client/search');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');

// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../../lambdas/db-migration');

const {
  getLambdaEnvironmentVariables,
  createAsyncOperation,
  startAsyncOperation,
} = require('../dist/async_operations');

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
  process.env = { ...process.env, ...localStackConnectionEnv, PG_DATABASE: testDbName };
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;

  systemBucket = randomString();
  await s3().createBucket({ Bucket: systemBucket }).promise();

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

  t.context.createSpy = sinon.spy((record) => Promise.resolve(record));
  t.context.deleteSpy = sinon.spy(() => true);
  t.context.stubbedAsyncOperationsModel = class {
    create = t.context.createSpy;

    delete = t.context.deleteSpy;
  };

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

test.afterEach.always((t) => {
  t.context.createSpy.resetHistory();
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
  }, t.context.stubbedAsyncOperationsModel);

  const spyCall = t.context.createSpy.getCall(0).args[0];

  const expected = {
    description,
    operationType: 'ES Index',
    status: 'RUNNING',
    taskArn,
  };

  t.like(result, {
    ...expected,
    id: spyCall.id,
  });
  t.deepEqual(omit(spyCall, ['id', 'createdAt', 'updatedAt']), expected);
  t.truthy(spyCall.id);
});

test.serial('The startAsyncOperation writes records to all data stores', async (t) => {
  const createSpy = sinon.spy((createObject) => createObject);
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

  const asyncOpDynamoSpyRecord = createSpy.getCall(0).args[0];
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
      ...asyncOpDynamoSpyRecord,
      _id: esRecord._id,
      timestamp: esRecord.timestamp,
    }
  );
  t.deepEqual(omit(asyncOpDynamoSpyRecord, ['createdAt', 'updatedAt']), omit(expected, ['createdAt', 'updatedAt']));
});

test.serial('The startAsyncOperation writes records with correct timestamps', async (t) => {
  const createSpy = sinon.spy((createObject) => createObject);
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

  const asyncOpDynamoSpyRecord = createSpy.getCall(0).args[0];
  const asyncOperationPgRecord = await t.context.asyncOperationPgModel.get(
    t.context.testKnex,
    { id }
  );
  t.is(asyncOperationPgRecord.created_at.getTime(), asyncOpDynamoSpyRecord.createdAt);
  t.is(asyncOperationPgRecord.updated_at.getTime(), asyncOpDynamoSpyRecord.updatedAt);

  const esRecord = await t.context.esAsyncOperationsClient.get(id);
  t.is(esRecord.createdAt, asyncOpDynamoSpyRecord.createdAt);
  t.is(esRecord.updatedAt, asyncOpDynamoSpyRecord.updatedAt);
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

test.serial('createAsyncOperation() does not write to Elasticsearch/DynamoDB if writing to PostgreSQL fails', async (t) => {
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
  };
  await t.throwsAsync(
    createAsyncOperation(createParams, t.context.stubbedAsyncOperationsModel),
    { message: 'something bad' }
  );

  t.false(t.context.createSpy.called);
  const dbRecords = await t.context.asyncOperationPgModel
    .search(t.context.testKnex, { id });
  t.is(dbRecords.length, 0);
  t.false(await t.context.esAsyncOperationsClient.exists(
    id
  ));
});

test.serial('createAsyncOperation() does not write to Elasticsearch/PostgreSQL if writing to DynamoDB fails', async (t) => {
  const { id, createObject } = t.context;

  const fakeCreate = () => {
    throw new Error('something bad');
  };
  const fakeCreateSpy = sinon.spy(fakeCreate);
  const deleteSpy = sinon.spy();
  class fakeAsyncOperationsModel {
    create(record) {
      return fakeCreateSpy(record);
    }

    delete(record) {
      deleteSpy(record);
    }
  }

  const createParams = {
    knex: t.context.testKnex,
    createObject,
  };
  await t.throwsAsync(
    createAsyncOperation(createParams, fakeAsyncOperationsModel),
    { message: 'something bad' }
  );

  t.true(fakeCreateSpy.threw());
  // Not called because no record was ever created
  t.false(deleteSpy.called);
  const dbRecords = await t.context.asyncOperationPgModel
    .search(t.context.testKnex, { id });
  t.is(dbRecords.length, 0);
  t.false(await t.context.esAsyncOperationsClient.exists(
    id
  ));
});

test.serial('createAsyncOperation() does not write to DynamoDB/PostgreSQL if writing to Elasticsearch fails', async (t) => {
  const { id, createObject } = t.context;
  const fakeEsClient = {
    index: () => {
      throw new Error('ES something bad');
    },
  };

  const createParams = {
    knex: t.context.testKnex,
    createObject,
    esClient: fakeEsClient,
  };
  await t.throwsAsync(
    createAsyncOperation(createParams, t.context.stubbedAsyncOperationsModel),
    { message: 'ES something bad' }
  );

  t.true(t.context.createSpy.called);
  t.true(t.context.deleteSpy.calledWith({ id: createObject.id }));
  const dbRecords = await t.context.asyncOperationPgModel
    .search(t.context.testKnex, { id });
  t.is(dbRecords.length, 0);
  t.false(await t.context.esAsyncOperationsClient.exists(
    id
  ));
});

'use strict';

const isString = require('lodash.isstring');
const test = require('ava');

const {
  aws: {
    ecs,
    recursivelyDeleteS3Bucket,
    s3
  },
  testUtils: { randomString }
} = require('@cumulus/common');

const { AsyncOperation } = require('../../models');

let asyncOperationModel;
let stubbedEcsRunTaskParams;
let stubbedEcsRunTaskResult;

let ecsClient;
let systemBucket;

test.before(async () => {
  systemBucket = randomString();
  await s3().createBucket({ Bucket: systemBucket }).promise();

  asyncOperationModel = new AsyncOperation({
    systemBucket,
    stackName: randomString(),
    tableName: randomString()
  });
  await asyncOperationModel.createTable();

  // Set up the mock ECS client
  ecsClient = ecs();
  ecsClient.runTask = (params) => {
    stubbedEcsRunTaskParams = params;
    return {
      promise: () => {
        if (!stubbedEcsRunTaskResult) return Promise.reject(new Error('stubbedEcsRunTaskResult has not yet been set'));
        return Promise.resolve(stubbedEcsRunTaskResult);
      }
    };
  };
});

test.after.always(async () => {
  await asyncOperationModel.deleteTable();
  await recursivelyDeleteS3Bucket(systemBucket);
});

test('The AsyncOperation constructor requires that stackName be specified', (t) => {
  try {
    new AsyncOperation({
      systemBucket: 'asdf',
      tableName: 'asdf'
    });
    t.fail('stackName should be required');
  } catch (err) {
    t.true(err instanceof TypeError);
    t.is(err.message, 'stackName is required');
  }
});

test('The AsyncOperation constructor requires that systemBucket be specified', (t) => {
  try {
    new AsyncOperation({
      stackName: 'asdf',
      tableName: 'asdf'
    });
    t.fail('systemBucket should be required');
  } catch (err) {
    t.true(err instanceof TypeError);
    t.is(err.message, 'systemBucket is required');
  }
});

test('The AsyncOperation constructor sets the stackName', (t) => {
  const thisTestStackName = randomString();
  const asyncOperation = new AsyncOperation({
    stackName: thisTestStackName,
    systemBucket: randomString(),
    tableName: randomString
  });

  t.is(asyncOperation.stackName, thisTestStackName);
});

test('The AsyncOperation constructor sets the systemBucket', (t) => {
  const localAsyncOperationModel = new AsyncOperation({
    stackName: randomString(),
    systemBucket,
    tableName: randomString
  });

  t.is(localAsyncOperationModel.systemBucket, systemBucket);
});

test.serial('The AsyncOperation.start() method uploads the payload to S3', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: []
  };

  const payload = { number: 42 };

  const { id } = await asyncOperationModel.start({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    payload
  });

  const getObjectResponse = await s3().getObject({
    Bucket: systemBucket,
    Key: `${asyncOperationModel.stackName}/async-operation-payloads/${id}.json`
  }).promise();

  t.deepEqual(JSON.parse(getObjectResponse.Body.toString()), payload);
});

test.serial('The AsyncOperation.start() method starts an ECS task with the correct parameters', async (t) => {
  stubbedEcsRunTaskParams = {};
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: []
  };

  const asyncOperationTaskDefinition = randomString();
  const cluster = randomString();
  const lambdaName = randomString();
  const payload = { x: randomString() };

  const { id } = await asyncOperationModel.start({
    asyncOperationTaskDefinition,
    cluster,
    lambdaName,
    payload
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

test('The AsyncAdapter.start() method sets the output if it is unable to create an ECS task', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [],
    failures: [{ arn: randomString(), reason: 'out of cheese' }]
  };

  const { id } = await asyncOperationModel.start({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    payload: {}
  });

  const { output } = await asyncOperationModel.get({ id });
  const parsedOutput = JSON.parse(output);
  t.is(parsedOutput.message, 'Failed to start AsyncOperation: out of cheese');
});

test.serial('The AsyncOperation.start() method writes a new record to DynamoDB', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: []
  };

  const { id } = await asyncOperationModel.start({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    payload: {}
  });

  const fetchedAsyncOperation = await asyncOperationModel.get({ id });
  t.is(fetchedAsyncOperation.taskArn, stubbedEcsRunTaskResult.tasks[0].taskArn);
});

test.serial('The AsyncOperation.start() method returns an item id', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: []
  };

  const { id } = await asyncOperationModel.start({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    payload: {}
  });

  t.true(isString(id));
});

test.serial('The AsyncOperation.start() method sets the record status to "RUNNING"', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: []
  };

  const { id } = await asyncOperationModel.start({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    payload: {}
  });

  const fetchedAsyncOperation = await asyncOperationModel.get({ id });
  t.is(fetchedAsyncOperation.status, 'RUNNING');
});

test.serial('The AsyncOperation.start() method returns the newly-generated record', async (t) => {
  stubbedEcsRunTaskResult = {
    tasks: [{ taskArn: randomString() }],
    failures: []
  };

  const { taskArn } = await asyncOperationModel.start({
    asyncOperationTaskDefinition: randomString(),
    cluster: randomString(),
    lambdaName: randomString(),
    payload: {}
  });

  t.is(taskArn, stubbedEcsRunTaskResult.tasks[0].taskArn);
});

'use strict';

const sleep = require('sleep-promise');
const fs = require('fs-extra');
const path = require('path');
const uuidv4 = require('uuid/v4');
const {
  aws: {
    dynamodb,
    ecs,
    lambda,
    s3
  },
  testUtils: { randomString }
} = require('@cumulus/common');
const { AsyncOperation } = require('@cumulus/api/models');
const { loadConfig } = require('../helpers/testUtils');

// Find the ECS Cluster ARN for the given Cumulus stack
async function getClusterArn(stackName) {
  const clusterPrefix = `${stackName}-CumulusECSCluster-`;
  const listClustersResponse = await ecs().listClusters().promise();
  return listClustersResponse.clusterArns.find((arn) => arn.includes(clusterPrefix));
}

async function waitForAsyncOperationStatus({
  TableName,
  id,
  status,
  retries = 5
}) {
  const { Item } = await dynamodb().getItem({
    TableName,
    Key: { id: { S: id } }
  }).promise();

  if (Item.status.S === status || retries <= 0) return Item;

  await sleep(2000);
  return waitForAsyncOperationStatus({
    TableName,
    id,
    status,
    retries: retries - 1
  });
}

describe('The AsyncOperation task runner', () => {
  let asyncOperationModel;
  let config;
  let cluster;
  let asyncOperationTaskDefinition;

  beforeAll(async () => {
    config = loadConfig();

    asyncOperationModel = new AsyncOperation({
      stackName: config.stackName,
      systemBucket: config.bucket,
      tableName: config.AsyncOperationsTable
    });

    // Find the ARN of the cluster
    cluster = await getClusterArn(config.stackName);

    // Find the ARN of the AsyncOperationTaskDefinition
    const { taskDefinitionArns } = await ecs().listTaskDefinitions().promise();
    asyncOperationTaskDefinition = taskDefinitionArns.find(
      (arn) => arn.includes(`${config.stackName}-AsyncOperationTaskDefinition-`)
    );
  });

  describe('running a non-existant lambda function', () => {
    let asyncOperationId;
    let taskArn;
    let dynamoDbItem;

    beforeAll(async () => {
      // Start the AsyncOperation
      ({
        id: asyncOperationId,
        taskArn
      } = await asyncOperationModel.start({
        asyncOperationTaskDefinition,
        cluster,
        lambdaName: 'does-not-exist',
        payload: {}
      }));

      await ecs().waitFor(
        'tasksStopped',
        {
          cluster,
          tasks: [taskArn]
        }
      ).promise();

      dynamoDbItem = await waitForAsyncOperationStatus({
        TableName: config.AsyncOperationsTable,
        id: asyncOperationId,
        status: 'RUNNER_FAILED'
      });
    });

    it('updates the status field in DynamoDB to "RUNNER_FAILED"', async () => {
      expect(dynamoDbItem.status.S).toEqual('RUNNER_FAILED');
    });

    it('updates the output field in DynamoDB', async () => {
      const parsedOutput = JSON.parse(dynamoDbItem.output.S);

      expect(parsedOutput.message).toContain('Function not found');
    });

    it('updates the updatedAt field in DynamoDB', async () => {
      expect(dynamoDbItem.updatedAt.N).toBeGreaterThan(dynamoDbItem.createdAt.N);
    });
  });

  describe('with a non-existant payload', () => {
    let asyncOperationId;
    let taskArn;
    let dynamoDbItem;
    let FunctionName;
    let lambdaKey;
    let payloadUrl;

    beforeAll(async () => {
      asyncOperationId = uuidv4();

      // Create the lambda function
      FunctionName = randomString();
      const zipPath = path.join(__dirname, 'lambdas.zip');
      lambdaKey = `integration-tests/lambdas/${randomString()}.zip`;

      await s3().upload({
        Bucket: config.bucket,
        Key: lambdaKey,
        Body: fs.createReadStream(zipPath)
      }).promise();

      await lambda().createFunction({
        FunctionName,
        Runtime: 'nodejs8.10',
        Role: config.asyncOperationRunnerRole,
        Handler: 'lambdas.success',
        Code: {
          S3Bucket: config.bucket,
          S3Key: lambdaKey
        }
      }).promise();

      await asyncOperationModel.create({
        id: asyncOperationId,
        taskArn: randomString(),
        status: 'RUNNING'
      });

      payloadUrl = `s3://${config.bucket}/${randomString()}`;
      const runTaskResponse = await ecs().runTask({
        cluster,
        taskDefinition: asyncOperationTaskDefinition,
        launchType: 'EC2',
        overrides: {
          containerOverrides: [
            {
              name: 'AsyncOperation',
              environment: [
                { name: 'asyncOperationId', value: asyncOperationId },
                { name: 'asyncOperationsTable', value: config.AsyncOperationsTable },
                { name: 'lambdaName', value: FunctionName },
                { name: 'payloadUrl', value: payloadUrl }
              ]
            }
          ]
        }
      }).promise();

      taskArn = runTaskResponse.tasks[0].taskArn;

      await ecs().waitFor(
        'tasksStopped',
        {
          cluster,
          tasks: [taskArn]
        }
      ).promise();

      dynamoDbItem = await waitForAsyncOperationStatus({
        TableName: config.AsyncOperationsTable,
        id: asyncOperationId,
        status: 'RUNNER_FAILED'
      });
    });

    afterAll(() => lambda().deleteFunction({ FunctionName }));

    it('updates the status field in DynamoDB to "RUNNER_FAILED"', async () => {
      expect(dynamoDbItem.status.S).toEqual('RUNNER_FAILED');
    });

    it('updates the output field in DynamoDB', async () => {
      const parsedOutput = JSON.parse(dynamoDbItem.output.S);

      expect(parsedOutput.message).toBe(`Failed to fetch ${payloadUrl}: The specified key does not exist.`);
    });

    it('updates the updatedAt field in DynamoDB', async () => {
      expect(dynamoDbItem.updatedAt.N).toBeGreaterThan(dynamoDbItem.createdAt.N);
    });
  });

  describe('with a non-JSON payload', () => {
    let asyncOperationId;
    let taskArn;
    let dynamoDbItem;
    let FunctionName;
    let lambdaZipKey;
    let payloadKey;

    beforeAll(async () => {
      asyncOperationId = uuidv4();

      // Create the lambda function
      FunctionName = randomString();
      const zipPath = path.join(__dirname, 'lambdas.zip');
      lambdaZipKey = `${config.stackName}/integration-tests/lambdas/${randomString()}.zip`;

      await s3().upload({
        Bucket: config.bucket,
        Key: lambdaZipKey,
        Body: fs.createReadStream(zipPath)
      }).promise();

      await lambda().createFunction({
        FunctionName,
        Runtime: 'nodejs8.10',
        Role: config.asyncOperationRunnerRole,
        Handler: 'lambdas.success',
        Code: {
          S3Bucket: config.bucket,
          S3Key: lambdaZipKey
        }
      }).promise();

      // Upload the payload
      payloadKey = `${config.stackName}/integration-tests/payloads/${randomString()}.json`;
      await s3().putObject({
        Bucket: config.bucket,
        Key: payloadKey,
        Body: 'invalid JSON'
      }).promise();

      await asyncOperationModel.create({
        id: asyncOperationId,
        taskArn: randomString(),
        status: 'RUNNING'
      });

      const runTaskResponse = await ecs().runTask({
        cluster,
        taskDefinition: asyncOperationTaskDefinition,
        launchType: 'EC2',
        overrides: {
          containerOverrides: [
            {
              name: 'AsyncOperation',
              environment: [
                { name: 'asyncOperationId', value: asyncOperationId },
                { name: 'asyncOperationsTable', value: config.AsyncOperationsTable },
                { name: 'lambdaName', value: FunctionName },
                { name: 'payloadUrl', value: `s3://${config.bucket}/${payloadKey}` }
              ]
            }
          ]
        }
      }).promise();

      taskArn = runTaskResponse.tasks[0].taskArn;

      await ecs().waitFor(
        'tasksStopped',
        {
          cluster,
          tasks: [taskArn]
        }
      ).promise();

      dynamoDbItem = await waitForAsyncOperationStatus({
        TableName: config.AsyncOperationsTable,
        id: asyncOperationId,
        status: 'TASK_FAILED'
      });
    });

    afterAll(() => Promise.all([
      lambda().deleteFunction({ FunctionName }),
      s3().deleteObject({ Bucket: config.bucket, Key: lambdaZipKey }).promise(),
      s3().deleteObject({ Bucket: config.bucket, Key: payloadKey }).promise()
    ]));

    it('updates the status field in DynamoDB to "TASK_FAILED"', async () => {
      expect(dynamoDbItem.status.S).toEqual('TASK_FAILED');
    });

    it('updates the output field in DynamoDB', async () => {
      const parsedOutput = JSON.parse(dynamoDbItem.output.S);

      expect(parsedOutput.message).toContain('Unable to parse payload:');
    });

    it('updates the updatedAt field in DynamoDB', async () => {
      expect(dynamoDbItem.updatedAt.N).toBeGreaterThan(dynamoDbItem.createdAt.N);
    });
  });

  describe('executing a successful lambda function', () => {
    let asyncOperationId;
    let taskArn;
    let dynamoDbItem;
    let FunctionName;
    let lambdaZipKey;
    let payloadKey;

    beforeAll(async () => {
      asyncOperationId = uuidv4();

      // Create the lambda function
      FunctionName = randomString();
      const zipPath = path.join(__dirname, 'lambdas.zip');
      lambdaZipKey = `${config.stackName}/integration-tests/lambdas/${randomString()}.zip`;

      await s3().upload({
        Bucket: config.bucket,
        Key: lambdaZipKey,
        Body: fs.createReadStream(zipPath)
      }).promise();

      await lambda().createFunction({
        FunctionName,
        Runtime: 'nodejs8.10',
        Role: config.asyncOperationRunnerRole,
        Handler: 'lambdas.success',
        Code: {
          S3Bucket: config.bucket,
          S3Key: lambdaZipKey
        }
      }).promise();

      // Upload the payload
      payloadKey = `${config.stackName}/integration-tests/payloads/${randomString()}.json`;
      await s3().putObject({
        Bucket: config.bucket,
        Key: payloadKey,
        Body: JSON.stringify([1, 2, 3])
      }).promise();

      await asyncOperationModel.create({
        id: asyncOperationId,
        taskArn: randomString(),
        status: 'RUNNING'
      });

      const runTaskResponse = await ecs().runTask({
        cluster,
        taskDefinition: asyncOperationTaskDefinition,
        launchType: 'EC2',
        overrides: {
          containerOverrides: [
            {
              name: 'AsyncOperation',
              environment: [
                { name: 'asyncOperationId', value: asyncOperationId },
                { name: 'asyncOperationsTable', value: config.AsyncOperationsTable },
                { name: 'lambdaName', value: FunctionName },
                { name: 'payloadUrl', value: `s3://${config.bucket}/${payloadKey}` }
              ]
            }
          ]
        }
      }).promise();

      taskArn = runTaskResponse.tasks[0].taskArn;

      await ecs().waitFor(
        'tasksStopped',
        {
          cluster,
          tasks: [taskArn]
        }
      ).promise();

      dynamoDbItem = await waitForAsyncOperationStatus({
        TableName: config.AsyncOperationsTable,
        id: asyncOperationId,
        status: 'SUCCEEDED'
      });
    });

    afterAll(() => Promise.all([
      lambda().deleteFunction({ FunctionName }),
      s3().deleteObject({ Bucket: config.bucket, Key: lambdaZipKey }).promise(),
      s3().deleteObject({ Bucket: config.bucket, Key: payloadKey }).promise()
    ]));

    it('updates the status field in DynamoDB to "SUCCEEDED"', async () => {
      expect(dynamoDbItem.status.S).toEqual('SUCCEEDED');
    });

    it('updates the output field in DynamoDB', async () => {
      const parsedOutput = JSON.parse(dynamoDbItem.output.S);

      expect(parsedOutput).toEqual([1, 2, 3]);
    });

    it('updates the updatedAt field in DynamoDB', async () => {
      expect(dynamoDbItem.updatedAt.N).toBeGreaterThan(dynamoDbItem.createdAt.N);
    });
  });

  describe('executing a failing lambda function', () => {
    let asyncOperationId;
    let taskArn;
    let dynamoDbItem;
    let FunctionName;
    let lambdaZipKey;
    let payloadKey;

    beforeAll(async () => {
      asyncOperationId = uuidv4();

      // Create the lambda function
      FunctionName = randomString();
      const zipPath = path.join(__dirname, 'lambdas.zip');
      lambdaZipKey = `${config.stackName}/integration-tests/lambdas/${randomString()}.zip`;

      await s3().upload({
        Bucket: config.bucket,
        Key: lambdaZipKey,
        Body: fs.createReadStream(zipPath)
      }).promise();

      await lambda().createFunction({
        FunctionName,
        Runtime: 'nodejs8.10',
        Role: config.asyncOperationRunnerRole,
        Handler: 'lambdas.fail',
        Code: {
          S3Bucket: config.bucket,
          S3Key: lambdaZipKey
        }
      }).promise();

      // Upload the payload
      payloadKey = `${config.stackName}/integration-tests/payloads/${randomString()}.json`;
      await s3().putObject({
        Bucket: config.bucket,
        Key: payloadKey,
        Body: JSON.stringify([1, 2, 3])
      }).promise();

      await asyncOperationModel.create({
        id: asyncOperationId,
        taskArn: randomString(),
        status: 'RUNNING'
      });

      const runTaskResponse = await ecs().runTask({
        cluster,
        taskDefinition: asyncOperationTaskDefinition,
        launchType: 'EC2',
        overrides: {
          containerOverrides: [
            {
              name: 'AsyncOperation',
              environment: [
                { name: 'asyncOperationId', value: asyncOperationId },
                { name: 'asyncOperationsTable', value: config.AsyncOperationsTable },
                { name: 'lambdaName', value: FunctionName },
                { name: 'payloadUrl', value: `s3://${config.bucket}/${payloadKey}` }
              ]
            }
          ]
        }
      }).promise();

      taskArn = runTaskResponse.tasks[0].taskArn;

      await ecs().waitFor(
        'tasksStopped',
        {
          cluster,
          tasks: [taskArn]
        }
      ).promise();

      dynamoDbItem = await waitForAsyncOperationStatus({
        TableName: config.AsyncOperationsTable,
        id: asyncOperationId,
        status: 'TASK_FAILED'
      });
    });

    afterAll(() => Promise.all([
      lambda().deleteFunction({ FunctionName }),
      s3().deleteObject({ Bucket: config.bucket, Key: lambdaZipKey }).promise(),
      s3().deleteObject({ Bucket: config.bucket, Key: payloadKey }).promise()
    ]));

    it('updates the status field in DynamoDB to "TASK_FAILED"', async () => {
      expect(dynamoDbItem.status.S).toEqual('TASK_FAILED');
    });

    it('updates the output field in DynamoDB', async () => {
      const parsedOutput = JSON.parse(dynamoDbItem.output.S);

      expect(parsedOutput.message).toBe('triggered failure');
    });

    it('updates the updatedAt field in DynamoDB', async () => {
      expect(dynamoDbItem.updatedAt.N).toBeGreaterThan(dynamoDbItem.createdAt.N);
    });
  });
});

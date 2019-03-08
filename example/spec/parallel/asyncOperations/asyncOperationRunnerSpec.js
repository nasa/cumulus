'use strict';

const uuidv4 = require('uuid/v4');
const {
  aws: { ecs, s3 },
  testUtils: { randomString }
} = require('@cumulus/common');
const {
  getClusterArn,
  waitForAsyncOperationStatus
} = require('@cumulus/integration-tests');
const { AsyncOperation } = require('@cumulus/api/models');
const { loadConfig } = require('../../helpers/testUtils');

describe('The AsyncOperation task runner', () => {
  let asyncOperationModel;
  let config;
  let cluster;
  let asyncOperationTaskDefinition;
  let successFunctionName;
  let failFunctionName;

  beforeAll(async () => {
    config = loadConfig();

    successFunctionName = `${config.prefix}-AsyncOperationSuccess`;
    failFunctionName = `${config.prefix}-AsyncOperationFail`;

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
      (arn) => arn.includes(`${config.prefix}-AsyncOperationTaskDefinition-`)
    );
  });

  describe('running a non-existent lambda function', () => {
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
    // Disabled pending resolution of CUMULUS-966
    xit('updates the updatedAt field in DynamoDB', async () => {
      expect(dynamoDbItem.updatedAt.N).toBeGreaterThan(dynamoDbItem.createdAt.N);
    });
  });

  describe('with a non-existent payload', () => {
    let asyncOperationId;
    let taskArn;
    let dynamoDbItem;
    let payloadUrl;

    beforeAll(async () => {
      asyncOperationId = uuidv4();

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
                { name: 'lambdaName', value: successFunctionName },
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

    it('updates the status field in DynamoDB to "RUNNER_FAILED"', async () => {
      expect(dynamoDbItem.status.S).toEqual('RUNNER_FAILED');
    });

    it('updates the output field in DynamoDB', async () => {
      const parsedOutput = JSON.parse(dynamoDbItem.output.S);

      expect(parsedOutput.message).toBe(`Failed to fetch ${payloadUrl}: The specified key does not exist.`);
    });
    // Disabled pending resolution of CUMULUS-966
    xit('updates the updatedAt field in DynamoDB', async () => {
      expect(dynamoDbItem.updatedAt.N).toBeGreaterThan(dynamoDbItem.createdAt.N);
    });
  });

  describe('with a non-JSON payload', () => {
    let asyncOperationId;
    let taskArn;
    let dynamoDbItem;
    let payloadKey;

    beforeAll(async () => {
      asyncOperationId = uuidv4();

      // Upload the payload
      payloadKey = `${config.stackName}/integration-tests/payloads/${asyncOperationId}.json`;
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
                { name: 'lambdaName', value: successFunctionName },
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

    it('updates the status field in DynamoDB to "TASK_FAILED"', async () => {
      expect(dynamoDbItem.status.S).toEqual('TASK_FAILED');
    });

    it('updates the output field in DynamoDB', async () => {
      const parsedOutput = JSON.parse(dynamoDbItem.output.S);

      expect(parsedOutput.message).toContain('Unable to parse payload:');
    });
    // Disabled pending resolution of CUMULUS-966
    xit('updates the updatedAt field in DynamoDB', async () => {
      expect(dynamoDbItem.updatedAt.N).toBeGreaterThan(dynamoDbItem.createdAt.N);
    });

    afterAll(() => s3().deleteObject({ Bucket: config.bucket, Key: payloadKey }).promise());
  });

  describe('executing a successful lambda function', () => {
    let asyncOperationId;
    let taskArn;
    let dynamoDbItem;
    let payloadKey;

    beforeAll(async () => {
      asyncOperationId = uuidv4();

      // Upload the payload
      payloadKey = `${config.stackName}/integration-tests/payloads/${asyncOperationId}.json`;
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
                { name: 'lambdaName', value: successFunctionName },
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

    it('updates the status field in DynamoDB to "SUCCEEDED"', async () => {
      expect(dynamoDbItem.status.S).toEqual('SUCCEEDED');
    });

    it('updates the output field in DynamoDB', async () => {
      const parsedOutput = JSON.parse(dynamoDbItem.output.S);

      expect(parsedOutput).toEqual([1, 2, 3]);
    });
    // Disabled pending resolution of CUMULUS-966
    xit('updates the updatedAt field in DynamoDB', async () => {
      expect(dynamoDbItem.updatedAt.N).toBeGreaterThan(dynamoDbItem.createdAt.N);
    });

    afterAll(() => s3().deleteObject({ Bucket: config.bucket, Key: payloadKey }).promise());
  });

  describe('executing a failing lambda function', () => {
    let asyncOperationId;
    let taskArn;
    let dynamoDbItem;
    let payloadKey;

    beforeAll(async () => {
      asyncOperationId = uuidv4();

      // Upload the payload
      payloadKey = `${config.stackName}/integration-tests/payloads/${asyncOperationId}.json`;
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
                { name: 'lambdaName', value: failFunctionName },
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

    it('updates the status field in DynamoDB to "TASK_FAILED"', async () => {
      expect(dynamoDbItem.status.S).toEqual('TASK_FAILED');
    });

    it('updates the output field in DynamoDB', async () => {
      const parsedOutput = JSON.parse(dynamoDbItem.output.S);

      expect(parsedOutput.message).toBe('triggered failure');
    });
    // Disabled pending resolution of CUMULUS-966
    xit('updates the updatedAt field in DynamoDB', async () => {
      expect(dynamoDbItem.updatedAt.N).toBeGreaterThan(dynamoDbItem.createdAt.N);
    });

    afterAll(() => s3().deleteObject({ Bucket: config.bucket, Key: payloadKey }).promise());
  });
});

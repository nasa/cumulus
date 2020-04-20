'use strict';

const get = require('lodash/get');
const uuidv4 = require('uuid/v4');
const { ecs, s3 } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');
const {
  getClusterArn,
  waitForAsyncOperationStatus
} = require('@cumulus/integration-tests');
const { AsyncOperation } = require('@cumulus/api/models');
const { loadConfig } = require('../helpers/testUtils');

describe('The AsyncOperation task runner with a non-JSON payload', () => {
  let asyncOperationId;
  let asyncOperationModel;
  let asyncOperationsTableName;
  let asyncOperationTaskDefinition;
  let beforeAllFailed = false;
  let cluster;
  let config;
  let dynamoDbItem;
  let payloadKey;
  let successFunctionName;
  let taskArn;

  beforeAll(async () => {
    try {
      config = await loadConfig();

      asyncOperationsTableName = `${config.stackName}-AsyncOperationsTable`;
      successFunctionName = `${config.stackName}-AsyncOperationSuccess`;

      asyncOperationModel = new AsyncOperation({
        stackName: config.stackName,
        systemBucket: config.bucket,
        tableName: asyncOperationsTableName
      });

      // Find the ARN of the cluster
      cluster = await getClusterArn(config.stackName);

      // Find the ARN of the AsyncOperationTaskDefinition
      const { taskDefinitionArns } = await ecs().listTaskDefinitions().promise();
      asyncOperationTaskDefinition = taskDefinitionArns.find(
        (arn) => arn.includes(`${config.stackName}-AsyncOperationTaskDefinition`)
      );

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
        description: 'Some description',
        operationType: 'ES Index',
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
                { name: 'asyncOperationsTable', value: asyncOperationsTableName },
                { name: 'lambdaName', value: successFunctionName },
                { name: 'payloadUrl', value: `s3://${config.bucket}/${payloadKey}` }
              ]
            }
          ]
        }
      }).promise();

      const failures = get(runTaskResponse, 'failures', []);
      if (failures.length > 0) {
        throw new Error(`Failed to start tasks: ${JSON.stringify(failures)}`);
      }

      taskArn = runTaskResponse.tasks[0].taskArn;

      await ecs().waitFor(
        'tasksStopped',
        {
          cluster,
          tasks: [taskArn]
        }
      ).promise();

      dynamoDbItem = await waitForAsyncOperationStatus({
        TableName: asyncOperationsTableName,
        id: asyncOperationId,
        status: 'TASK_FAILED'
      });
    } catch (err) {
      beforeAllFailed = true;
      throw err;
    }
  });

  it('updates the status field in DynamoDB to "TASK_FAILED"', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else expect(dynamoDbItem.status.S).toEqual('TASK_FAILED');
  });

  it('updates the output field in DynamoDB', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      const parsedOutput = JSON.parse(dynamoDbItem.output.S);

      expect(parsedOutput.message).toContain('Unable to parse payload:');
    }
  });

  it('updates the updatedAt field in DynamoDB', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else expect(dynamoDbItem.updatedAt.N).toBeGreaterThan(dynamoDbItem.createdAt.N);
  });

  afterAll(() => s3().deleteObject({ Bucket: config.bucket, Key: payloadKey }).promise());
});

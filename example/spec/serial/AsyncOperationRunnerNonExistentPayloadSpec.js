'use strict';

const get = require('lodash/get');
const uuidv4 = require('uuid/v4');
const { ecs } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');
const {
  getClusterArn,
  waitForAsyncOperationStatus
} = require('@cumulus/integration-tests');
const { AsyncOperation } = require('@cumulus/api/models');
const { loadConfig } = require('../helpers/testUtils');

describe('The AsyncOperation task runner with a non-existent payload', () => {
  let asyncOperationId;
  let asyncOperationModel;
  let asyncOperationsTableName;
  let asyncOperationTaskDefinition;
  let beforeAllFailed = false;
  let cluster;
  let config;
  let dynamoDbItem;
  let payloadUrl;
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

      await asyncOperationModel.create({
        id: asyncOperationId,
        taskArn: randomString(),
        description: 'Some description',
        operationType: 'ES Index',
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
                { name: 'asyncOperationsTable', value: asyncOperationsTableName },
                { name: 'lambdaName', value: successFunctionName },
                { name: 'payloadUrl', value: payloadUrl }
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
        status: 'RUNNER_FAILED'
      });
    } catch (err) {
      beforeAllFailed = true;
      throw err;
    }
  });

  it('updates the status field in DynamoDB to "RUNNER_FAILED"', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else expect(dynamoDbItem.status.S).toEqual('RUNNER_FAILED');
  });

  it('updates the output field in DynamoDB', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      const parsedOutput = JSON.parse(dynamoDbItem.output.S);

      expect(parsedOutput.message).toBe(`Failed to fetch ${payloadUrl}: The specified key does not exist.`);
    }
  });

  it('updates the updatedAt field in DynamoDB', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else expect(dynamoDbItem.updatedAt.N).toBeGreaterThan(dynamoDbItem.createdAt.N);
  });
});

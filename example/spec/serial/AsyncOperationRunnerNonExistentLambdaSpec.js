'use strict';

const { ecs } = require('@cumulus/aws-client/services');
const { getClusterArn, waitForAsyncOperationStatus } = require('@cumulus/integration-tests');
const { AsyncOperation } = require('@cumulus/api/models');
const { loadConfig } = require('../helpers/testUtils');

describe('The AsyncOperation task runner running a non-existent lambda function', () => {
  let asyncOperationId;
  let asyncOperationModel;
  let asyncOperationsTableName;
  let asyncOperationTaskDefinition;
  let beforeAllFailed = false;
  let cluster;
  let config;
  let dynamoDbItem;
  let taskArn;

  beforeAll(async () => {
    try {
      config = await loadConfig();

      asyncOperationsTableName = `${config.stackName}-AsyncOperationsTable`;

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

      // Start the AsyncOperation
      ({
        id: asyncOperationId,
        taskArn
      } = await asyncOperationModel.start({
        asyncOperationTaskDefinition,
        cluster,
        lambdaName: 'does-not-exist',
        description: 'Some description',
        operationType: 'ES Index',
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

      expect(parsedOutput.message).toContain('Function not found');
    }
  });

  it('updates the updatedAt field in DynamoDB', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else expect(dynamoDbItem.updatedAt.N).toBeGreaterThan(dynamoDbItem.createdAt.N);
  });
});

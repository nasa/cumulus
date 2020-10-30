'use strict';

const asyncOperations = require('@cumulus/async-operations');
const { ecs } = require('@cumulus/aws-client/services');
const { getClusterArn, waitForAsyncOperationStatus } = require('@cumulus/integration-tests');
const { AsyncOperation } = require('@cumulus/api/models');
const { findAsyncOperationTaskDefinitionForDeployment } = require('../helpers/ecsHelpers');
const { loadConfig } = require('../helpers/testUtils');

describe('The AsyncOperation task runner running a non-existent lambda function', () => {
  let asyncOperation;
  let asyncOperationId;
  let asyncOperationModel;
  let asyncOperationsTableName;
  let asyncOperationTaskDefinition;
  let beforeAllFailed = false;
  let cluster;
  let config;
  let taskArn;

  beforeAll(async () => {
    try {
      config = await loadConfig();

      asyncOperationsTableName = `${config.stackName}-AsyncOperationsTable`;

      const stackName = config.stackName;
      const systemBucket = config.bucket;
      const dynamoTableName = asyncOperationsTableName;

      // Find the ARN of the cluster
      cluster = await getClusterArn(config.stackName);

      // Find the ARN of the AsyncOperationTaskDefinition
      asyncOperationTaskDefinition = await findAsyncOperationTaskDefinitionForDeployment(config.stackName);

      // Start the AsyncOperation
      ({
        id: asyncOperationId,
        taskArn,
      } = await await asyncOperations.startAsyncOperation({
        asyncOperationTaskDefinition,
        cluster,
        lambdaName: 'does-not-exist',
        description: 'Some description',
        operationType: 'ES Index',
        payload: {},
        stackName,
        systemBucket,
        dynamoTableName,
      }, AsyncOperation));

      await ecs().waitFor(
        'tasksStopped',
        {
          cluster,
          tasks: [taskArn],
        }
      ).promise();

      asyncOperation = await waitForAsyncOperationStatus({
        id: asyncOperationId,
        status: 'RUNNER_FAILED',
        stackName: config.stackName,
      });
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  it('updates the status field in DynamoDB to "RUNNER_FAILED"', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else expect(asyncOperation.status).toEqual('RUNNER_FAILED');
  });

  it('updates the output field in DynamoDB', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      const parsedOutput = JSON.parse(asyncOperation.output);

      expect(parsedOutput.message).toContain('Function not found');
    }
  });
});

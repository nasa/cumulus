'use strict';

const { waitUntilTasksStopped } = require('@aws-sdk/client-ecs');

const get = require('lodash/get');
const { v4: uuidv4 } = require('uuid');
const { createAsyncOperation, deleteAsyncOperation } = require('@cumulus/api-client/asyncOperations');
const { startECSTask } = require('@cumulus/async-operations');
const { ecs, s3 } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');
const { getClusterArn, waitForAsyncOperationStatus } = require('@cumulus/integration-tests');
const { findAsyncOperationTaskDefinitionForDeployment } = require('../helpers/ecsHelpers');
const { loadConfig } = require('../helpers/testUtils');

describe('The AsyncOperation task runner executing a failing lambda function', () => {
  let asyncOperation;
  let asyncOperationId;
  let asyncOperationTaskDefinition;
  let beforeAllFailed = false;
  let cluster;
  let config;
  let failFunctionName;
  let payloadKey;
  let taskArn;

  beforeAll(async () => {
    try {
      config = await loadConfig();

      failFunctionName = `${config.stackName}-AsyncOperationFail`;

      // Find the ARN of the cluster
      cluster = await getClusterArn(config.stackName);

      // Find the ARN of the AsyncOperationTaskDefinition
      asyncOperationTaskDefinition = await findAsyncOperationTaskDefinitionForDeployment(config.stackName);

      asyncOperationId = uuidv4();

      // Upload the payload
      payloadKey = `${config.stackName}/integration-tests/payloads/${asyncOperationId}.json`;
      await s3().putObject({
        Bucket: config.bucket,
        Key: payloadKey,
        Body: JSON.stringify([1, 2, 3]),
      });

      const asyncOperationObject = {
        id: asyncOperationId,
        taskArn: randomString(),
        description: 'Some description',
        operationType: 'Bulk Granules',
        status: 'RUNNING',
      };

      await createAsyncOperation({ prefix: config.stackName, asyncOperation: asyncOperationObject });

      const runTaskResponse = await startECSTask({
        asyncOperationTaskDefinition,
        cluster,
        callerLambdaName: `${config.stackName}-ApiEndpoints`,
        lambdaName: failFunctionName,
        id: asyncOperationId,
        payloadBucket: config.bucket,
        payloadKey,
      });

      const failures = get(runTaskResponse, 'failures', []);
      if (failures.length > 0) {
        throw new Error(`Failed to start tasks: ${JSON.stringify(failures)}`);
      }

      taskArn = runTaskResponse.tasks[0].taskArn;

      await waitUntilTasksStopped(
        { client: ecs(), maxWaitTime: 600, maxDelay: 1, minDelay: 1 },
        { cluster: cluster, tasks: [taskArn] }
      );

      asyncOperation = await waitForAsyncOperationStatus({
        id: asyncOperationId,
        status: 'TASK_FAILED',
        stackName: config.stackName,
      });
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  it('updates the status field to "TASK_FAILED"', () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else expect(asyncOperation.status).toEqual('TASK_FAILED');
  });

  it('updates the output field in DynamoDB', () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      const parsedOutput = JSON.parse(asyncOperation.output);

      expect(parsedOutput.message).toBe('triggered failure');
    }
  });

  afterAll(async () => {
    await s3().deleteObject({ Bucket: config.bucket, Key: payloadKey });
    if (asyncOperationId) {
      await deleteAsyncOperation({ prefix: config.stackName, asyncOperationId });
    }
  });
});

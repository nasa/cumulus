'use strict';

const { waitUntilTasksStopped } = require('@aws-sdk/client-ecs');

const get = require('lodash/get');
const { v4: uuidv4 } = require('uuid');
const { createAsyncOperation, deleteAsyncOperation, listAsyncOperations } = require('@cumulus/api-client/asyncOperations');
const { startECSTask } = require('@cumulus/async-operations');
const { ecs, s3 } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');
const {
  getClusterArn,
  waitForAsyncOperationStatus,
} = require('@cumulus/integration-tests');
const { findAsyncOperationTaskDefinitionForDeployment } = require('../helpers/ecsHelpers');
const { loadConfig } = require('../helpers/testUtils');

describe('The AsyncOperation task runner executing a successful lambda function', () => {
  let asyncOperation;
  let asyncOperationId;
  let asyncOperationTaskDefinition;
  let beforeAllError = false;
  let cluster;
  let config;
  let payloadKey;
  let successFunctionName;
  let taskArn;

  beforeAll(async () => {
    try {
      config = await loadConfig();

      successFunctionName = `${config.stackName}-AsyncOperationSuccess`;

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
        description: 'Some description',
        operationType: 'ES Index',
        id: asyncOperationId,
        taskArn: randomString(),
        status: 'RUNNING',
      };

      await createAsyncOperation({ prefix: config.stackName, asyncOperation: asyncOperationObject });
      console.log('Async Operation ID: %s', asyncOperationId);

      const runTaskResponse = await startECSTask({
        asyncOperationTaskDefinition,
        cluster,
        callerLambdaName: `${config.stackName}-ApiEndpoints`,
        lambdaName: successFunctionName,
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
        status: 'SUCCEEDED',
        stackName: config.stackName,
      });
    } catch (error) {
      beforeAllError = true;
      throw error;
    }
  });

  it('updates the status field to "SUCCEEDED"', () => {
    if (beforeAllError) fail(beforeAllError);
    else expect(asyncOperation.status).toEqual('SUCCEEDED');
  });

  it('updates the output field', () => {
    if (beforeAllError) fail(beforeAllError);
    else {
      const parsedOutput = JSON.parse(asyncOperation.output);
      expect(parsedOutput).toEqual([1, 2, 3]);
    }
  });

  it('returns the updated record from GET /asyncOperations', async () => {
    if (beforeAllError) fail(beforeAllError);
    else {
      const response = await listAsyncOperations({
        prefix: config.stackName,
        query: {
          id: asyncOperationId,
        },
      });
      const { results } = JSON.parse(response.body);
      expect(results.length).toEqual(1);
      const [record] = results;
      expect(record.status).toEqual('SUCCEEDED');
      const parsedOutput = JSON.parse(record.output);
      expect(parsedOutput).toEqual([1, 2, 3]);
    }
  });

  afterAll(async () => {
    await s3().deleteObject({ Bucket: config.bucket, Key: payloadKey });
    if (asyncOperationId) {
      await deleteAsyncOperation({ prefix: config.stackName, asyncOperationId });
    }
  });
});

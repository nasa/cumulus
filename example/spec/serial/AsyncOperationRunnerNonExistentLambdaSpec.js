'use strict';

const { v4: uuidv4 } = require('uuid');

const { createAsyncOperation, deleteAsyncOperation } = require('@cumulus/api-client/asyncOperations');
const { startECSTask } = require('@cumulus/async-operations');
const { ecs, s3 } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');
const { getClusterArn, waitForAsyncOperationStatus } = require('@cumulus/integration-tests');
const { findAsyncOperationTaskDefinitionForDeployment } = require('../helpers/ecsHelpers');
const { loadConfig } = require('../helpers/testUtils');
function getAllMethods(obj = this) {
  return Object.keys(obj)
      .filter((key) => typeof obj[key] === 'function')
      .map((key) => obj[key]);
}
describe('The AsyncOperation task runner running a non-existent lambda function', () => {
  let asyncOperation;
  let asyncOperationId;
  let asyncOperationTaskDefinition;
  let beforeAllFailed = false;
  let cluster;
  let config;
  let payloadKey;

  beforeAll(async () => {
    try {
      config = await loadConfig();

      // Find the ARN of the cluster
      cluster = await getClusterArn(config.stackName);

      // Find the ARN of the AsyncOperationTaskDefinition
      asyncOperationTaskDefinition = await findAsyncOperationTaskDefinitionForDeployment(config.stackName);
      asyncOperationId = uuidv4();

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
        operationType: 'ES Index',
        status: 'RUNNING',
      };

      await createAsyncOperation({ prefix: config.stackName, asyncOperation: asyncOperationObject });

      const runTaskResponse = await startECSTask({
        asyncOperationTaskDefinition,
        cluster,
        callerLambdaName: `${config.stackName}-ApiEndpoints`,
        lambdaName: 'notARealFunction',
        id: asyncOperationId,
        payloadBucket: config.bucket,
        payloadKey,
      });

      const taskArn = runTaskResponse.tasks[0].taskArn;
      const EECC = ecs();
      console.log(getAllMethods(EECC));
      await ecs().waitFor(
        'tasksStopped',
        {
          cluster,
          tasks: [taskArn],
        }
      );

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

  afterAll(async () => {
    await s3().deleteObject({ Bucket: config.bucket, Key: payloadKey });
    if (asyncOperationId) {
      await deleteAsyncOperation({ prefix: config.stackName, asyncOperationId });
    }
  });

  it('updates the status field in DynamoDB to "RUNNER_FAILED"', () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else expect(asyncOperation.status).toEqual('RUNNER_FAILED');
  });

  it('updates the output field in DynamoDB', () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      const parsedOutput = JSON.parse(asyncOperation.output);

      expect(parsedOutput.message).toContain('Function not found');
    }
  });
});

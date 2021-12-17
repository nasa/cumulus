'use strict';

const get = require('lodash/get');
const uuidv4 = require('uuid/v4');
const {
  createAsyncOperation,
  deleteAsyncOperation,
  listAsyncOperations,
} = require('@cumulus/api-client/asyncOperations');
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
  let asyncOperationsTableName;
  let asyncOperationTaskDefinition;
  let beforeAllError;
  let cluster;
  let config;
  let payloadKey;
  let successFunctionName;
  let taskArn;

  beforeAll(async () => {
    try {
      config = await loadConfig();

      asyncOperationsTableName = `${config.stackName}-AsyncOperationsTable`;
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
      }).promise();

      const asyncOperationObject = {
        id: asyncOperationId,
        taskArn: randomString(),
        description: 'Some description',
        operationType: 'ES Index',
        status: 'RUNNING',
      };

      await createAsyncOperation({ prefix: config.stackName, asyncOperation: asyncOperationObject });

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
                { name: 'payloadUrl', value: `s3://${config.bucket}/${payloadKey}` },
              ],
            },
          ],
        },
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
          tasks: [taskArn],
        }
      ).promise();

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
      expect(response.results.length).toEqual(1);
      const [record] = response.results;
      expect(record.status).toEqual('SUCCEEDED');
      const parsedOutput = JSON.parse(record.output);
      expect(parsedOutput).toEqual([1, 2, 3]);
    }
  });

  afterAll(async () => {
    await s3().deleteObject({ Bucket: config.bucket, Key: payloadKey }).promise();
    if (asyncOperationId) {
      await deleteAsyncOperation({ prefix: config.stackName, asyncOperationId });
    }
  });
});

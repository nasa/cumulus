'use strict';

const pTimeout = require('p-timeout');
const { deleteAsyncOperation } = require('@cumulus/api-client/asyncOperations');
const { waitForAsyncOperationStatus } = require('@cumulus/integration-tests');
const { lambda } = require('@cumulus/aws-client/services');

const {
  loadConfig,
} = require('../../helpers/testUtils');

describe('Invoking the postgres-migration-async-operation lambda starts an async operation', () => {
  let asyncOperation;
  let asyncOperationId;
  let beforeAllFailed = false;
  let config;
  let migrationLambdaOutput;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      const prefix = config.stackName;
      const FunctionName = `${prefix}-postgres-migration-async-operation`;

      const functionConfig = await lambda().getFunctionConfiguration({
        FunctionName,
      }).promise();

      migrationLambdaOutput = await pTimeout(
        lambda().invoke({ FunctionName, Payload: '' }).promise(),
        (functionConfig.Timeout + 10) * 1000
      );
      asyncOperationId = JSON.parse(migrationLambdaOutput.Payload).id;

      asyncOperation = await waitForAsyncOperationStatus({
        id: asyncOperationId,
        status: 'SUCCEEDED',
        stackName: prefix,
        retryOptions: {
          retries: 30 * 5,
        },
      });
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  afterAll(async () => {
    if (asyncOperationId) {
      await deleteAsyncOperation(
        { prefix: config.stackName, asyncOperationId }
      );
    }
  });

  it('updates the status field to "SUCCEEDED"', () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else expect(asyncOperation.status).toEqual('SUCCEEDED');
  });
});

'use strict';

const { waitUntilTasksStopped } = require('@aws-sdk/client-ecs');
const { deleteAsyncOperation, getAsyncOperation } = require('@cumulus/api-client/asyncOperations');
const { bulkRemoveFromCmr } = require('@cumulus/api-client/granules');
const { ecs } = require('@cumulus/aws-client/services');
const { randomId } = require('@cumulus/common/test-utils');
const { getClusterArn } = require('@cumulus/integration-tests');

const { isValidAsyncOperationId, loadConfig } = require('../../helpers/testUtils');

describe('POST /granules/bulkRemoveFromCmr with a failed bulk remove from CMR operation', () => {
  let postBulkRemoveFromCmrResponse;
  let postBulkRemoveFromCmrBody;
  let config;
  let clusterArn;
  let missingGranuleId;
  let taskArn;
  let beforeAllSucceeded = false;
  let prefix;

  // A granule ID that does not exist in the database will fail to be removed
  // from CMR with a RecordDoesNotExist error, but should not fail the overall
  // async operation.

  beforeAll(async () => {
    config = await loadConfig();
    prefix = config.stackName;

    // Figure out what cluster we're using
    clusterArn = await getClusterArn(config.stackName);
    if (!clusterArn) throw new Error('Unable to find ECS cluster');

    missingGranuleId = randomId('missing-granule-id-');

    postBulkRemoveFromCmrResponse = await bulkRemoveFromCmr({
      prefix,
      body: {
        granules: [missingGranuleId],
      },
    });
    postBulkRemoveFromCmrBody = JSON.parse(postBulkRemoveFromCmrResponse.body);

    // Query the AsyncOperation API to get the task ARN
    const asyncOperation = await getAsyncOperation({
      prefix,
      asyncOperationId: postBulkRemoveFromCmrBody.id,
    });
    ({ taskArn } = asyncOperation);

    beforeAllSucceeded = true;
  });

  afterAll(async () => {
    if (postBulkRemoveFromCmrBody.id) {
      await deleteAsyncOperation({ prefix, asyncOperationId: postBulkRemoveFromCmrBody.id });
    }
  });

  it('returns a status code of 202', () => {
    expect(beforeAllSucceeded).toBeTrue();
    expect(postBulkRemoveFromCmrResponse.statusCode).toEqual(202);
  });

  it('returns an Async Operation Id', () => {
    expect(beforeAllSucceeded).toBeTrue();
    expect(isValidAsyncOperationId(postBulkRemoveFromCmrBody.id)).toBeTrue();
  });

  it('creates an AsyncOperation', async () => {
    expect(beforeAllSucceeded).toBeTrue();

    const asyncOperation = await getAsyncOperation({
      prefix,
      asyncOperationId: postBulkRemoveFromCmrBody.id,
    });

    expect(asyncOperation.id).toEqual(postBulkRemoveFromCmrBody.id);
  });

  it('runs an ECS task', async () => {
    expect(beforeAllSucceeded).toBeTrue();

    // Verify that the task ARN exists in that cluster
    const describeTasksResponse = await ecs().describeTasks({
      cluster: clusterArn,
      tasks: [taskArn],
    });

    expect(describeTasksResponse.tasks.length).toEqual(1);
  });

  it('eventually generates the correct output, reporting the per-granule error without failing the operation', async () => {
    expect(beforeAllSucceeded).toBeTrue();

    await waitUntilTasksStopped(
      { client: ecs(), maxWaitTime: 600, maxDelay: 1, minDelay: 1 },
      { cluster: clusterArn, tasks: [taskArn] }
    );

    const asyncOperation = await getAsyncOperation({
      prefix,
      asyncOperationId: postBulkRemoveFromCmrBody.id,
    });

    expect(asyncOperation.status).toEqual('SUCCEEDED');

    let output;
    try {
      output = JSON.parse(asyncOperation.output);
    } catch {
      throw new SyntaxError(`asyncOperation.output is not valid JSON: ${asyncOperation.output}`);
    }

    expect(output).toEqual([{ granuleId: missingGranuleId, error: 'RecordDoesNotExist' }]);
  });
});

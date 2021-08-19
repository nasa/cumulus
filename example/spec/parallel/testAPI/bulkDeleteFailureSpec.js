'use strict';

const { fakeGranuleFactoryV2 } = require('@cumulus/api/lib/testUtils');
const Granule = require('@cumulus/api/models/granules');
const { deleteAsyncOperation, getAsyncOperation } = require('@cumulus/api-client/asyncOperations');
const granules = require('@cumulus/api-client/granules');
const { ecs } = require('@cumulus/aws-client/services');
const {
  getClusterArn,
} = require('@cumulus/integration-tests');
const { isValidAsyncOperationId, loadConfig } = require('../../helpers/testUtils');

describe('POST /granules/bulkDelete with a failed bulk delete operation', () => {
  let postBulkDeleteResponse;
  let postBulkDeleteBody;
  let config;
  let clusterArn;
  let taskArn;
  let beforeAllSucceeded = false;

  // Published granule will fail to delete unless override for bulk
  // delete request is specified
  const granule = fakeGranuleFactoryV2({ published: true });

  beforeAll(async () => {
    config = await loadConfig();

    // Figure out what cluster we're using
    clusterArn = await getClusterArn(config.stackName);
    if (!clusterArn) throw new Error('Unable to find ECS cluster');

    process.env.GranulesTable = `${config.stackName}-GranulesTable`;
    const granulesModel = new Granule();
    await granulesModel.create(granule);

    postBulkDeleteResponse = await granules.bulkDeleteGranules({
      prefix: config.stackName,
      body: {
        ids: [granule.granuleId],
      },
    });
    postBulkDeleteBody = JSON.parse(postBulkDeleteResponse.body);

    // Query the AsyncOperation API to get the task ARN
    const asyncOperation = await getAsyncOperation({
      prefix: config.stackName,
      asyncOperationId: postBulkDeleteBody.id,
    });
    ({ taskArn } = asyncOperation);

    beforeAllSucceeded = true;
  });

  afterAll(async () => {
    if (postBulkDeleteBody.id) {
      await deleteAsyncOperation({ prefix: config.stackName, asyncOperationId: postBulkDeleteBody.id });
    }
  });

  it('returns a status code of 202', () => {
    expect(beforeAllSucceeded).toBeTrue();
    expect(postBulkDeleteResponse.statusCode).toEqual(202);
  });

  it('returns an Async Operation Id', () => {
    expect(beforeAllSucceeded).toBeTrue();
    expect(isValidAsyncOperationId(postBulkDeleteBody.id)).toBeTrue();
  });

  it('creates an AsyncOperation', async () => {
    expect(beforeAllSucceeded).toBeTrue();

    const asyncOperation = await getAsyncOperation({
      prefix: config.stackName,
      asyncOperationId: postBulkDeleteBody.id,
    });

    expect(asyncOperation.id).toEqual(postBulkDeleteBody.id);
  });

  it('runs an ECS task', async () => {
    expect(beforeAllSucceeded).toBeTrue();

    // Verify that the task ARN exists in that cluster
    const describeTasksResponse = await ecs().describeTasks({
      cluster: clusterArn,
      tasks: [taskArn],
    }).promise();

    expect(describeTasksResponse.tasks.length).toEqual(1);
  });

  it('eventually generates the correct output', async () => {
    expect(beforeAllSucceeded).toBeTrue();

    await ecs().waitFor(
      'tasksStopped',
      {
        cluster: clusterArn,
        tasks: [taskArn],
      }
    ).promise();

    const asyncOperation = await getAsyncOperation({
      prefix: config.stackName,
      asyncOperationId: postBulkDeleteBody.id,
    });

    expect(asyncOperation.status).toEqual('TASK_FAILED');

    let output;
    try {
      output = JSON.parse(asyncOperation.output);
    } catch (error) {
      throw new SyntaxError(`getAsyncOperationBody.output is not valid JSON: ${asyncOperation.output}`);
    }

    expect(output.name).toBe('AggregateError');
    expect(output.message).toContain('DeletePublishedGranule');
    expect(output.stack).toBeDefined();
  });
});

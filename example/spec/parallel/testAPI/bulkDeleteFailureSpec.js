'use strict';

const { fakeGranuleFactoryV2, fakeExecutionFactoryV2 } = require('@cumulus/api/lib/testUtils');
const { deleteAsyncOperation, getAsyncOperation } = require('@cumulus/api-client/asyncOperations');
const { ecs } = require('@cumulus/aws-client/services');
const { waitUntilTasksStopped } = require('@aws-sdk/client-ecs');
const {
  getClusterArn,
  loadCollection,
} = require('@cumulus/integration-tests');
const {
  bulkDeleteGranules,
  createGranule,
  deleteGranule,
  updateGranule,
} = require('@cumulus/api-client/granules');
const { createCollection, deleteCollection } = require('@cumulus/api-client/collections');
const { createExecution, deleteExecution } = require('@cumulus/api-client/executions');
const { encodedConstructCollectionId } = require('../../helpers/Collections');

const { isValidAsyncOperationId, loadConfig, createTimestampedTestId } = require('../../helpers/testUtils');

describe('POST /granules/bulkDelete with a failed bulk delete operation', () => {
  let postBulkDeleteResponse;
  let postBulkDeleteBody;
  let collection;
  let config;
  let clusterArn;
  let execution;
  let granule;
  let taskArn;
  let beforeAllSucceeded = false;
  let prefix;

  // Published granule will fail to delete unless override for bulk
  // delete request is specified

  beforeAll(async () => {
    config = await loadConfig();
    prefix = config.stackName;

    const testId = createTimestampedTestId(prefix, 'bulkDeleteFailureSpec');

    // Figure out what cluster we're using
    clusterArn = await getClusterArn(config.stackName);
    if (!clusterArn) throw new Error('Unable to find ECS cluster');

    // Create execution
    execution = fakeExecutionFactoryV2();
    await createExecution({
      prefix,
      body: execution,
    });

    // Create the collection
    const fakeCollection = await loadCollection({
      filename: './data/collections/s3_MOD09GQ_006/s3_MOD09GQ_006.json',
      postfix: testId,
    });
    const collectionResponse = await createCollection({ prefix, collection: fakeCollection });
    collection = JSON.parse(collectionResponse.body).record;

    // Create granule
    granule = fakeGranuleFactoryV2({
      published: true,
      execution: execution.execution,
      collectionId: encodedConstructCollectionId(collection.name, collection.version),
    });
    await createGranule({
      prefix,
      body: granule,
    });

    postBulkDeleteResponse = await bulkDeleteGranules({
      prefix: config.stackName,
      body: {
        granules: [{ granuleId: granule.granuleId, collectionId: granule.collectionId }],
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
    // mark granule as unpublished to allow delete
    await updateGranule({
      prefix,
      granuleId: granule.granuleId,
      collectionId: granule.collectionId,
      body: {
        ...granule,
        published: false,
      },
    });

    await deleteGranule({ prefix, granuleId: granule.granuleId, collectionId: granule.collectionId });
    await deleteCollection({
      prefix,
      collectionName: collection.name,
      collectionVersion: collection.version,
    });
    await deleteExecution({ prefix, executionArn: execution.arn });
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
    });

    expect(describeTasksResponse.tasks.length).toEqual(1);
  });

  it('eventually generates the correct output', async () => {
    expect(beforeAllSucceeded).toBeTrue();

    await waitUntilTasksStopped(
      { client: ecs(), maxWaitTime: 600, maxDelay: 1, minDelay: 1 },
      { cluster: clusterArn, tasks: [taskArn] }
    );

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

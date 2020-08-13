'use strict';

const { fakeGranuleFactoryV2 } = require('@cumulus/api/lib/testUtils');
const Granule = require('@cumulus/api/models/granules');
const granules = require('@cumulus/api-client/granules');
const { ecs } = require('@cumulus/aws-client/services');
const {
  api: apiTestUtils,
  getClusterArn,
} = require('@cumulus/integration-tests');
const { loadConfig } = require('../../helpers/testUtils');

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
    const getAsyncOperationResponse = await apiTestUtils.getAsyncOperation({
      prefix: config.stackName,
      id: postBulkDeleteBody.id,
    });
    ({ taskArn } = JSON.parse(getAsyncOperationResponse.body));

    beforeAllSucceeded = true;
  });

  it('returns a status code of 202', () => {
    expect(beforeAllSucceeded).toBeTrue();
    expect(postBulkDeleteResponse.statusCode).toEqual(202);
  });

  it('returns an Async Operation Id', () => {
    expect(beforeAllSucceeded).toBeTrue();
    expect(postBulkDeleteBody.id).toMatch(/[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}/);
  });

  it('creates an AsyncOperation', async () => {
    expect(beforeAllSucceeded).toBeTrue();

    const getAsyncOperationResponse = await apiTestUtils.getAsyncOperation({
      prefix: config.stackName,
      id: postBulkDeleteBody.id,
    });

    expect(getAsyncOperationResponse.statusCode).toEqual(200);

    const getAsyncOperationBody = JSON.parse(getAsyncOperationResponse.body);

    expect(getAsyncOperationBody.id).toEqual(postBulkDeleteBody.id);
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

    const getAsyncOperationResponse = await apiTestUtils.getAsyncOperation({
      prefix: config.stackName,
      id: postBulkDeleteBody.id,
    });

    const getAsyncOperationBody = JSON.parse(getAsyncOperationResponse.body);

    expect(getAsyncOperationResponse.statusCode).toEqual(200);
    expect(getAsyncOperationBody.status).toEqual('TASK_FAILED');

    let output;
    try {
      output = JSON.parse(getAsyncOperationBody.output);
    } catch (error) {
      throw new SyntaxError(`getAsyncOperationBody.output is not valid JSON: ${getAsyncOperationBody.output}`);
    }

    expect(output.name).toBe('AggregateError');
    expect(output.message).toContain('DeletePublishedGranule');
    expect(output.stack).toBeDefined();
  });
});

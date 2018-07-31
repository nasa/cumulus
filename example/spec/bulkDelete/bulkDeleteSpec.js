'use strict';

const { ecs } = require('@cumulus/common/aws');
const {
  api: apiTestUtils,
  getClusterArn
} = require('@cumulus/integration-tests');
const { loadConfig } = require('../helpers/testUtils');

describe('POST /bulkDelete with a successful bulk delete operation', () => {
  let postBulkDeleteResponse;
  let postBulkDeleteBody;
  let config;
  let clusterArn;
  let taskArn;

  let beforeAllSucceeded = false;
  beforeAll(async () => {
    config = loadConfig();

    // Figure out what cluster we're using
    clusterArn = await getClusterArn(config.stackName);
    if (!clusterArn) throw new Error('Unable to find ECS cluster');

    postBulkDeleteResponse = await apiTestUtils.postBulkDelete({
      prefix: config.stackName,
      granuleIds: ['g-123']
    });
    postBulkDeleteBody = JSON.parse(postBulkDeleteResponse.body);

    // Query the AsyncOperation API to get the task ARN
    const getAsyncOperationResponse = await apiTestUtils.getAsyncOperation({
      prefix: config.stackName,
      id: postBulkDeleteBody.asyncOperationId
    });
    ({ taskArn } = JSON.parse(getAsyncOperationResponse.body));

    beforeAllSucceeded = true;
  });

  it('returns a status code of 202', () => {
    expect(beforeAllSucceeded).toBe(true);
    expect(postBulkDeleteResponse.statusCode).toEqual(202);
  });

  it('returns an Async Operation Id', () => {
    expect(beforeAllSucceeded).toBe(true);
    expect(postBulkDeleteBody.asyncOperationId).toMatch(/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/);
  });

  it('creates an AsyncOperation', async () => {
    expect(beforeAllSucceeded).toBe(true);

    const getAsyncOperationResponse = await apiTestUtils.getAsyncOperation({
      prefix: config.stackName,
      id: postBulkDeleteBody.asyncOperationId
    });

    expect(getAsyncOperationResponse.statusCode).toEqual(200);

    const getAsyncOperationBody = JSON.parse(getAsyncOperationResponse.body);

    expect(getAsyncOperationBody.id).toEqual(postBulkDeleteBody.asyncOperationId);
  });

  it('runs an ECS task', async () => {
    expect(beforeAllSucceeded).toBe(true);

    // Verify that the task ARN exists in that cluster
    const describeTasksResponse = await ecs().describeTasks({
      cluster: clusterArn,
      tasks: [taskArn]
    }).promise();

    expect(describeTasksResponse.tasks.length).toEqual(1);
  });

  it('eventually generates the correct result', async () => {
    expect(beforeAllSucceeded).toBe(true);

    await ecs().waitFor(
      'tasksStopped',
      {
        cluster: clusterArn,
        tasks: [taskArn]
      }
    ).promise();

    const getAsyncOperationResponse = await apiTestUtils.getAsyncOperation({
      prefix: config.stackName,
      id: postBulkDeleteBody.asyncOperationId
    });

    const getAsyncOperationBody = JSON.parse(getAsyncOperationResponse.body);

    expect(getAsyncOperationResponse.statusCode).toEqual(200);
    expect(getAsyncOperationBody.status).toEqual('SUCCEEDED');
    expect(getAsyncOperationBody.error).toBeUndefined();

    let result;
    try {
      result = JSON.parse(getAsyncOperationBody.result);
    }
    catch (err) {
      throw new SyntaxError(`getAsyncOperationBody.result is not valid JSON: ${getAsyncOperationBody.result}`);
    }

    expect(result).toEqual({ deletedGranules: ['g-123'] });
  });
});

describe('POST /bulkDelete with a failed bulk delete operation', () => {
  let postBulkDeleteResponse;
  let postBulkDeleteBody;
  let config;
  let clusterArn;
  let taskArn;

  let beforeAllSucceeded = false;
  beforeAll(async () => {
    config = loadConfig();

    // Figure out what cluster we're using
    clusterArn = await getClusterArn(config.stackName);
    if (!clusterArn) throw new Error('Unable to find ECS cluster');

    postBulkDeleteResponse = await apiTestUtils.postBulkDelete({
      prefix: config.stackName,
      granuleIds: ['trigger-failure']
    });
    postBulkDeleteBody = JSON.parse(postBulkDeleteResponse.body);

    // Query the AsyncOperation API to get the task ARN
    const getAsyncOperationResponse = await apiTestUtils.getAsyncOperation({
      prefix: config.stackName,
      id: postBulkDeleteBody.asyncOperationId
    });
    ({ taskArn } = JSON.parse(getAsyncOperationResponse.body));

    beforeAllSucceeded = true;
  });

  it('returns a status code of 202', () => {
    expect(beforeAllSucceeded).toBe(true);
    expect(postBulkDeleteResponse.statusCode).toEqual(202);
  });

  it('returns an Async Operation Id', () => {
    expect(beforeAllSucceeded).toBe(true);
    expect(postBulkDeleteBody.asyncOperationId).toMatch(/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/);
  });

  it('creates an AsyncOperation', async () => { // eslint-disable-line sonarjs/no-identical-functions
    expect(beforeAllSucceeded).toBe(true);

    const getAsyncOperationResponse = await apiTestUtils.getAsyncOperation({
      prefix: config.stackName,
      id: postBulkDeleteBody.asyncOperationId
    });

    expect(getAsyncOperationResponse.statusCode).toEqual(200);

    const getAsyncOperationBody = JSON.parse(getAsyncOperationResponse.body);

    expect(getAsyncOperationBody.id).toEqual(postBulkDeleteBody.asyncOperationId);
  });

  it('runs an ECS task', async () => { // eslint-disable-line sonarjs/no-identical-functions
    expect(beforeAllSucceeded).toBe(true);

    // Verify that the task ARN exists in that cluster
    const describeTasksResponse = await ecs().describeTasks({
      cluster: clusterArn,
      tasks: [taskArn]
    }).promise();

    expect(describeTasksResponse.tasks.length).toEqual(1);
  });

  it('eventually generates the correct result', async () => {
    expect(beforeAllSucceeded).toBe(true);

    await ecs().waitFor(
      'tasksStopped',
      {
        cluster: clusterArn,
        tasks: [taskArn]
      }
    ).promise();

    const getAsyncOperationResponse = await apiTestUtils.getAsyncOperation({
      prefix: config.stackName,
      id: postBulkDeleteBody.asyncOperationId
    });

    const getAsyncOperationBody = JSON.parse(getAsyncOperationResponse.body);

    expect(getAsyncOperationResponse.statusCode).toEqual(200);
    expect(getAsyncOperationBody.status).toEqual('FAILED');
    expect(getAsyncOperationBody.error).toEqual('triggered failure');
    expect(getAsyncOperationBody.result).toBeUndefined();
  });
});

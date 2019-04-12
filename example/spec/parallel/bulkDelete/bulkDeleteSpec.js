'use strict';

const { ecs } = require('@cumulus/common/aws');
const {
  api: apiTestUtils,
  getClusterArn
} = require('@cumulus/integration-tests');
const { loadConfig } = require('../../helpers/testUtils');

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

  it('eventually generates the correct output', async () => {
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

    let output;
    try {
      output = JSON.parse(getAsyncOperationBody.output);
    } catch (err) {
      throw new SyntaxError(`getAsyncOperationBody.output is not valid JSON: ${getAsyncOperationBody.output}`);
    }

    expect(output).toEqual({ deletedGranules: ['g-123'] });
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

  it('eventually generates the correct output', async () => {
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
    expect(getAsyncOperationBody.status).toEqual('TASK_FAILED');

    let output;
    try {
      output = JSON.parse(getAsyncOperationBody.output);
    } catch (err) {
      throw new SyntaxError(`getAsyncOperationBody.output is not valid JSON: ${getAsyncOperationBody.output}`);
    }

    expect(output.name).toBe('Error');
    expect(output.message).toBe('triggered failure');
    expect(output.stack).toBeDefined();
  });
});

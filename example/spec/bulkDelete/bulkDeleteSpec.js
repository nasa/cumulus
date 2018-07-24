'use strict';

const sleep = require('sleep-promise');
const { ecs } = require('@cumulus/common/aws');
const { api: apiTestUtils } = require('@cumulus/integration-tests');
const { loadConfig, templateFile, getExecutionUrl } = require('../helpers/testUtils');

describe('POST /bulkDelete with a successful bulk delete operation', () => {
  let postBulkDeleteResponse;
  let postBulkDeleteBody;
  let config;

  beforeAll(async () => {
    config = loadConfig();

    postBulkDeleteResponse = await apiTestUtils.postBulkDelete({
      prefix: config.stackName,
      granuleIds: ['g-123']
    });
    postBulkDeleteBody = JSON.parse(postBulkDeleteResponse.body);
  });

  it('returns a status code of 202', () => {
    expect(postBulkDeleteResponse.statusCode).toEqual(202);
  });

  it('returns an Async Operation Id', () => {
    expect(postBulkDeleteBody.asyncOperationId).toMatch(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/);
  });

  it('creates an AsyncOperation', async () => {
    const getAsyncOperationResponse = await apiTestUtils.getAsyncOperation({
      prefix: config.stackName,
      id: postBulkDeleteBody.asyncOperationId
    });

    expect(getAsyncOperationResponse.statusCode).toEqual(200);

    const getAsyncOperationBody = JSON.parse(getAsyncOperationResponse.body);
    expect(getAsyncOperationBody.id).toEqual(postBulkDeleteBody.asyncOperationId);
  });

  it('runs an ECS task', async () => {
    const clusterPrefix = `${config.stackName}-CumulusECSCluster-`;
    const listClustersResponse = await ecs().listClusters().promise();
    const clusterArn = listClustersResponse.clusterArns.find((arn) => arn.includes(clusterPrefix));
    if (!clusterArn) throw new Error('Unable to find ECS cluster');

    const getAsyncOperationResponse = await apiTestUtils.getAsyncOperation({
      prefix: config.stackName,
      id: postBulkDeleteBody.asyncOperationId
    });

    expect(getAsyncOperationResponse.statusCode).toEqual(200);

    const getAsyncOperationBody = JSON.parse(getAsyncOperationResponse.body);

    const describeTasksResponse = await ecs().describeTasks({
      cluster: clusterArn,
      tasks: [getAsyncOperationBody.taskArn]
    }).promise();

    expect(describeTasksResponse.tasks.length).toEqual(1);
  });

  it('eventually generates the correct result', async () => {
    const isTerminalState = (state) => ['SUCCEEDED', 'FAILED'].includes(state);

    let getAsyncOperationResponse;
    let getAsyncOperationBody;
    let checksRemaining = 60;

    do {
      getAsyncOperationResponse = await apiTestUtils.getAsyncOperation({ // eslint-disable-line no-await-in-loop
        prefix: config.stackName,
        id: postBulkDeleteBody.asyncOperationId
      });
      getAsyncOperationBody = JSON.parse(getAsyncOperationResponse.body);

      if (isTerminalState(getAsyncOperationBody.status)) break;

      console.log(`Async Operation status: ${getAsyncOperationBody.status}.  Sleeping ...`);

      checksRemaining -= 1;
      await sleep(2000); // eslint-disable-line no-await-in-loop
    } while (checksRemaining > 0);

    if (checksRemaining === 0) {
      console.log('Timed out waiting for completion.  Last status:');
      console.log(JSON.stringify(getAsyncOperationBody, null, 2));
      throw new Error('Timed out');
    }

    expect(getAsyncOperationResponse.statusCode).toEqual(200);
    expect(getAsyncOperationBody.status).toEqual('SUCCEEDED');
    expect(getAsyncOperationBody.error).toBeUndefined();

    let result;
    try {
      result = JSON.parse(getAsyncOperationBody.result);
    }
    catch (err) {
      if (err instanceof SyntaxError) result = getAsyncOperationBody.result;
      else throw err;
    }
    expect(result).toEqual({ deletedGranules: ['g-123'] });
  });
});

describe('POST /bulkDelete with a failed bulk delete operation', () => {
  let postBulkDeleteResponse;
  let postBulkDeleteBody;
  let config;

  beforeAll(async () => {
    config = loadConfig();

    postBulkDeleteResponse = await apiTestUtils.postBulkDelete({
      prefix: config.stackName,
      granuleIds: ['trigger-failure']
    });
    postBulkDeleteBody = JSON.parse(postBulkDeleteResponse.body);
  });

  it('returns a status code of 202', () => {
    expect(postBulkDeleteResponse.statusCode).toEqual(202);
  });

  it('returns an Async Operation Id', () => {
    expect(postBulkDeleteBody.asyncOperationId).toMatch(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/);
  });

  it('creates an AsyncOperation', async () => {
    const getAsyncOperationResponse = await apiTestUtils.getAsyncOperation({
      prefix: config.stackName,
      id: postBulkDeleteBody.asyncOperationId
    });

    expect(getAsyncOperationResponse.statusCode).toEqual(200);

    const getAsyncOperationBody = JSON.parse(getAsyncOperationResponse.body);
    expect(getAsyncOperationBody.id).toEqual(postBulkDeleteBody.asyncOperationId);
  });

  it('runs an ECS task', async () => {
    const clusterPrefix = `${config.stackName}-CumulusECSCluster-`;
    const listClustersResponse = await ecs().listClusters().promise();
    const clusterArn = listClustersResponse.clusterArns.find((arn) => arn.includes(clusterPrefix));
    if (!clusterArn) throw new Error('Unable to find ECS cluster');

    const getAsyncOperationResponse = await apiTestUtils.getAsyncOperation({
      prefix: config.stackName,
      id: postBulkDeleteBody.asyncOperationId
    });

    expect(getAsyncOperationResponse.statusCode).toEqual(200);

    const getAsyncOperationBody = JSON.parse(getAsyncOperationResponse.body);

    const describeTasksResponse = await ecs().describeTasks({
      cluster: clusterArn,
      tasks: [getAsyncOperationBody.taskArn]
    }).promise();

    expect(describeTasksResponse.tasks.length).toEqual(1);
  });

  it('eventually generates the correct result', async () => {
    const isTerminalState = (state) => ['SUCCEEDED', 'FAILED'].includes(state);

    let getAsyncOperationResponse;
    let getAsyncOperationBody;
    let checksRemaining = 60;

    do {
      getAsyncOperationResponse = await apiTestUtils.getAsyncOperation({ // eslint-disable-line no-await-in-loop
        prefix: config.stackName,
        id: postBulkDeleteBody.asyncOperationId
      });
      getAsyncOperationBody = JSON.parse(getAsyncOperationResponse.body);

      if (isTerminalState(getAsyncOperationBody.status)) break;

      console.log(`Async Operation status: ${getAsyncOperationBody.status}.  Sleeping ...`);

      checksRemaining -= 1;
      await sleep(2000); // eslint-disable-line no-await-in-loop
    } while (checksRemaining > 0);

    if (checksRemaining === 0) {
      console.log('Timed out waiting for completion.  Last status:');
      console.log(JSON.stringify(getAsyncOperationBody, null, 2));
      throw new Error('Timed out');
    }

    expect(getAsyncOperationResponse.statusCode).toEqual(200);
    expect(getAsyncOperationBody.status).toEqual('FAILED');
    expect(getAsyncOperationBody.error).toEqual('triggered failure');
    expect(getAsyncOperationBody.result).toBeUndefined();
  });
});

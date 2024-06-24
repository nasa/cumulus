const { waitUntilTasksStopped } = require('@aws-sdk/client-ecs');

const { deleteAsyncOperation, getAsyncOperation } = require('@cumulus/api-client/asyncOperations');
const {
  bulkDeleteByCollection,
  createExecution,
  getExecutions,
} = require('@cumulus/api-client/executions');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { ecs } = require('@cumulus/aws-client/services');
const { randomId } = require('@cumulus/common/test-utils');
const {
  getClusterArn,
} = require('@cumulus/integration-tests');
const { createCollection } = require('@cumulus/integration-tests/Collections');
const { constructCollectionId } = require('@cumulus/message/Collections');
const {
  createTimestampedTestId,
  createTestSuffix,
  loadConfig,
  isValidAsyncOperationId,
} = require('../../helpers/testUtils');

describe('POST /executions/bulk-delete-by-collection', () => {
  let config;
  let prefix;
  let originalExecutions;
  let beforeAllSucceeded = false;
  let collectionId;
  let bulkDeleteByCollectionResponse;
  let taskArn;
  let clusterArn;
  let id;
  let collection;

  // Create Random Collection via api-client publish methods

  beforeAll(async () => {
    config = await loadConfig();
    prefix = config.stackName;

    clusterArn = await getClusterArn(config.stackName);
    if (!clusterArn) throw new Error('Unable to find ECS cluster');

    const testId = createTimestampedTestId(config.stackName, 'bulkDeleteSuccess');
    const testSuffix = createTestSuffix(testId);
    collection = {
      name: `executionTest${testSuffix}`,
      version: '001',
    };

    try {
      collectionId = constructCollectionId(collection.name, collection.version);

      await createCollection(
        prefix,
        {
          ...collection,
          duplicateHandling: 'error',
        }
      );
      // Create 10 executions
      await Promise.all(
        Array.from(
          { length: 10 },
          () => createExecution({
            prefix,
            body: {
              collectionId,
              arn: randomId('arn'),
              status: 'completed',
              name: randomId('name'),
            },
          })
        )
      );

      originalExecutions = await getExecutions({
        prefix,
        query: {
          fields: ['arn'],
          collectionId,
        },
      });

      bulkDeleteByCollectionResponse = await bulkDeleteByCollection({
        prefix,
        payload: {
          collectionId,
          esBatchSize: 2,
          dbBatchSize: 2,
        },
      });
      const asyncOperation = await getAsyncOperation(
        {
          prefix,
          asyncOperationId: JSON.parse(bulkDeleteByCollectionResponse.body).id,
        }
      );
      ({ taskArn, id } = asyncOperation);
      beforeAllSucceeded = true;
    } catch (error) {
      console.log(error);
    }
  });
  afterAll(async () => {
    await deleteAsyncOperation({ prefix, asyncOperationId: id });
    await deleteCollection({
      prefix,
      collectionName: collection.name,
      collectionVersion: collection.version,
    });
  });
  describe('delete executions by collection', () => {
    it('has a correctly setup test', () => {
      expect(beforeAllSucceeded).toBeTrue();
      expect(JSON.parse(originalExecutions.body).results.length).toBe(10);
    });

    it('returns an Async Operation Id', () => {
      expect(beforeAllSucceeded).toBeTrue();
      expect(isValidAsyncOperationId(id)).toBeTrue();
      console.log(`Bulk delete async operation id: ${id}`);
    });

    it('creates an AsyncOperation', async () => {
      expect(beforeAllSucceeded).toBeTrue();
      const asyncOperation = await getAsyncOperation({
        prefix,
        asyncOperationId: id,
      });

      expect(asyncOperation.id).toEqual(id);
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

    it('eventually succeeds', async () => {
      expect(beforeAllSucceeded).toBeTrue();

      await waitUntilTasksStopped(
        { client: ecs(), maxWaitTime: 600, maxDelay: 1, minDelay: 1 },
        { cluster: clusterArn, tasks: [taskArn] }
      );

      const asyncOperation = await getAsyncOperation({
        prefix,
        asyncOperationId: id,
      });
      expect(asyncOperation.status).toEqual('SUCCEEDED');
    });

    it('has removed the expected records from the database', async () => {
      expect(beforeAllSucceeded).toBeTrue();
      const executionQueryResponse = await getExecutions({
        prefix,
        query: {
          fields: ['arn'],
          collectionId,
        },
      });
      expect(bulkDeleteByCollectionResponse.statusCode).toBe(202);
      expect(JSON.parse(executionQueryResponse.body).results.length).toBe(0);
    });
  });
});

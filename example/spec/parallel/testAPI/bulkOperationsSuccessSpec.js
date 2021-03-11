'use strict';

const get = require('lodash/get');
const pAll = require('p-all');

const granules = require('@cumulus/api-client/granules');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteProvider } = require('@cumulus/api-client/providers');
const { deleteRule } = require('@cumulus/api-client/rules');
const { ecs } = require('@cumulus/aws-client/services');
const { s3PutObject } = require('@cumulus/aws-client/S3');
const {
  getQueueUrlByName,
} = require('@cumulus/aws-client/SQS');
const { randomId } = require('@cumulus/common/test-utils');
const {
  api: apiTestUtils,
  getClusterArn,
  getExecutionInputObject,
} = require('@cumulus/integration-tests');
const { createCollection } = require('@cumulus/integration-tests/Collections');
const {
  findExecutionArn, getExecutionWithStatus,
} = require('@cumulus/integration-tests/Executions');
const { getGranuleWithStatus } = require('@cumulus/integration-tests/Granules');
const { createProvider } = require('@cumulus/integration-tests/Providers');
const { createOneTimeRule } = require('@cumulus/integration-tests/Rules');

const {
  createTimestampedTestId,
  createTestSuffix,
  loadConfig,
} = require('../../helpers/testUtils');

describe('POST /granules/bulk', () => {
  let config;
  let clusterArn;
  let prefix;

  beforeAll(async () => {
    config = await loadConfig();
    prefix = config.stackName;
    process.env.stackName = config.stackName;
    process.env.system_bucket = config.bucket;

    // Figure out what cluster we're using
    clusterArn = await getClusterArn(config.stackName);
    if (!clusterArn) throw new Error('Unable to find ECS cluster');
  });

  describe('runs workflow on provided granules', () => {
    let beforeAllSucceeded = false;
    let postBulkGranulesResponse;
    let postBulkOperationsBody;
    let taskArn;
    let collection;
    let provider;
    let ingestGranuleRule;
    let granuleId;
    let ingestedGranule;
    let scheduleQueueUrl;
    let bulkRequestTime;

    beforeAll(async () => {
      try {
        const sourceBucket = config.bucket;
        const testId = createTimestampedTestId(config.stackName, 'bulkOperationSuccess');
        const testSuffix = createTestSuffix(testId);

        // The S3 path where granules will be ingested from
        const sourcePath = `${prefix}/tmp/${testSuffix}`;

        // Create the collection
        const cmrCollection = {
          name: `MCD43A1${testSuffix}`,
          dataType: 'MCD43A1',
          version: '006',
        };
        collection = await createCollection(
          prefix,
          {
            ...cmrCollection,
            duplicateHandling: 'error',
            process: 'modis',
          }
        );

        // Create the S3 provider
        provider = await createProvider(prefix, { host: sourceBucket });

        const filename = `${randomId('file')}.txt`;
        const fileKey = `${sourcePath}/${filename}`;
        await s3PutObject({
          Bucket: sourceBucket,
          Key: fileKey,
          Body: 'asdf',
        });

        granuleId = randomId('granule-id-');

        const ingestTime = Date.now() - 1000 * 30;

        // Ingest the granule the first time
        const testExecutionId = randomId('test-execution-');
        ingestGranuleRule = await createOneTimeRule(
          prefix,
          {
            workflow: 'IngestGranule',
            collection: {
              name: collection.name,
              version: collection.version,
            },
            provider: provider.id,
            payload: {
              testExecutionId,
              granules: [
                {
                  granuleId,
                  dataType: collection.name,
                  version: collection.version,
                  files: [
                    {
                      name: filename,
                      path: sourcePath,
                    },
                  ],
                },
              ],
            },
          }
        );

        // Find the execution ARN
        const firstIngestGranuleExecutionArn = await findExecutionArn(
          prefix,
          (execution) => {
            const executionId = get(execution, 'originalPayload.testExecutionId');
            return executionId === ingestGranuleRule.payload.testExecutionId;
          },
          { timestamp__from: ingestTime },
          { timeout: 15 }
        );

        // Wait for the execution to be completed
        await getExecutionWithStatus({
          prefix,
          arn: firstIngestGranuleExecutionArn,
          status: 'completed',
          timeout: 60,
        });

        // Wait for the granule to be fully ingested
        ingestedGranule = await getGranuleWithStatus({ prefix, granuleId, status: 'completed' });

        scheduleQueueUrl = await getQueueUrlByName(`${config.stackName}-backgroundProcessing`);
        bulkRequestTime = Date.now() - 1000 * 30;
        postBulkGranulesResponse = await granules.bulkGranules({
          prefix,
          body: {
            ids: [granuleId],
            workflowName: 'HelloWorldWorkflow',
            queueUrl: scheduleQueueUrl,
          },
        });
        postBulkOperationsBody = JSON.parse(postBulkGranulesResponse.body);

        // Query the AsyncOperation API to get the task ARN
        const getAsyncOperationResponse = await apiTestUtils.getAsyncOperation({
          prefix,
          id: postBulkOperationsBody.id,
        });
        ({ taskArn } = JSON.parse(getAsyncOperationResponse.body));
        beforeAllSucceeded = true;
      } catch (error) {
        console.log(error);
      }
    });

    afterAll(async () => {
      // Must delete rules before deleting associated collection and provider
      await deleteRule({ prefix, ruleName: get(ingestGranuleRule, 'name') });

      await pAll(
        [
          () => deleteProvider({ prefix, providerId: get(provider, 'id') }),
          () => deleteCollection({
            prefix,
            collectionName: get(collection, 'name'),
            collectionVersion: get(collection, 'version'),
          }),
          () => granules.deleteGranule({ prefix, granuleId }),
        ],
        { stopOnError: false }
      ).catch(console.error);
    });

    it('ingested granule is archived', () => {
      expect(beforeAllSucceeded).toBeTrue();
      expect(ingestedGranule).toBeTruthy();
    });

    it('returns a status code of 202', () => {
      expect(beforeAllSucceeded).toBeTrue();
      expect(postBulkGranulesResponse.statusCode).toEqual(202);
    });

    it('returns an Async Operation Id', () => {
      expect(beforeAllSucceeded).toBeTrue();
      expect(postBulkOperationsBody.id).toMatch(/[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}/);
    });

    it('creates an AsyncOperation', async () => {
      expect(beforeAllSucceeded).toBeTrue();

      const getAsyncOperationResponse = await apiTestUtils.getAsyncOperation({
        prefix,
        id: postBulkOperationsBody.id,
      });

      expect(getAsyncOperationResponse.statusCode).toEqual(200);

      const getAsyncOperationBody = JSON.parse(getAsyncOperationResponse.body);

      expect(getAsyncOperationBody.id).toEqual(postBulkOperationsBody.id);
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
        prefix,
        id: postBulkOperationsBody.id,
      });

      const getAsyncOperationBody = JSON.parse(getAsyncOperationResponse.body);

      expect(getAsyncOperationResponse.statusCode).toEqual(200);
      expect(getAsyncOperationBody.status).toEqual('SUCCEEDED');

      let output;
      try {
        output = JSON.parse(getAsyncOperationBody.output);
      } catch (error) {
        throw new SyntaxError(`getAsyncOperationBody.output is not valid JSON: ${getAsyncOperationBody.output}`);
      }
      expect(output).toEqual([granuleId]);
    });

    it('starts a workflow with an execution message referencing the correct queue URL', async () => {
      // Find the execution ARN
      const bulkOperationExecutionArn = await findExecutionArn(
        prefix,
        (execution) => {
          const asyncOperationId = get(execution, 'asyncOperationId');
          return asyncOperationId === postBulkOperationsBody.id;
        },
        { timestamp__from: bulkRequestTime },
        { timeout: 60 }
      );

      // Wait for the execution to be completed
      await getExecutionWithStatus({
        prefix,
        arn: bulkOperationExecutionArn,
        status: 'completed',
        timeout: 60,
      });

      const executionInput = await getExecutionInputObject(bulkOperationExecutionArn);
      expect(executionInput.cumulus_meta.queueUrl).toBe(scheduleQueueUrl);
    });
  });
});

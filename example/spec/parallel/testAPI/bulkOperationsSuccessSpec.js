'use strict';

const get = require('lodash/get');
const pAll = require('p-all');

const granules = require('@cumulus/api-client/granules');
const { deleteAsyncOperation, getAsyncOperation } = require('@cumulus/api-client/asyncOperations');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteExecution } = require('@cumulus/api-client/executions');
const { deleteProvider } = require('@cumulus/api-client/providers');
const { deleteRule } = require('@cumulus/api-client/rules');
const { ecs } = require('@cumulus/aws-client/services');
const { s3PutObject } = require('@cumulus/aws-client/S3');
const {
  getQueueUrlByName,
} = require('@cumulus/aws-client/SQS');
const { randomId } = require('@cumulus/common/test-utils');
const {
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
const { constructCollectionId } = require('@cumulus/message/Collections');

const {
  createTimestampedTestId,
  createTestSuffix,
  loadConfig,
  isValidAsyncOperationId,
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
    let beforeAllFailed = false;
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
    let ingestGranuleExecution1Arn;
    let bulkOperationExecutionArn;

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
        console.log('granuleId', granuleId);

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
        ingestGranuleExecution1Arn = await findExecutionArn(
          prefix,
          (execution) => {
            const executionId = get(execution, 'originalPayload.testExecutionId');
            return executionId === ingestGranuleRule.payload.testExecutionId;
          },
          {
            timestamp__from: ingestTime,
            'originalPayload.testExecutionId': ingestGranuleRule.payload.testExecutionId,
          },
          { timeout: 30 }
        );

        console.log(`Ingest Execution ARN is : ${ingestGranuleExecution1Arn}`);

        // Wait for the execution to be completed
        await getExecutionWithStatus({
          prefix,
          arn: ingestGranuleExecution1Arn,
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
            granules: [{ granuleId, collectionId: constructCollectionId(collection.name, collection.version) }],
            workflowName: 'HelloWorldWorkflow',
            queueUrl: scheduleQueueUrl,
          },
        });
        postBulkOperationsBody = JSON.parse(postBulkGranulesResponse.body);

        console.log(`bulk operations async operation ID: ${postBulkOperationsBody.id}`);

        // Query the AsyncOperation API to get the task ARN
        const asyncOperation = await getAsyncOperation({
          prefix,
          asyncOperationId: postBulkOperationsBody.id,
        });
        ({ taskArn } = asyncOperation);
      } catch (error) {
        beforeAllFailed = true;
        console.log(error);
        throw error;
      }
    });

    afterAll(async () => {
      // Must delete rules and executions before deleting associated collection and provider
      await deleteRule({ prefix, ruleName: get(ingestGranuleRule, 'name') });
      await deleteExecution({ prefix: config.stackName, executionArn: ingestGranuleExecution1Arn });
      await deleteExecution({ prefix: config.stackName, executionArn: bulkOperationExecutionArn });

      await granules.deleteGranule({ prefix, granuleId });
      if (postBulkOperationsBody.id) {
        await deleteAsyncOperation({ prefix: config.stackName, asyncOperationId: postBulkOperationsBody.id });
      }

      await pAll(
        [
          () => deleteProvider({ prefix, providerId: get(provider, 'id') }),
          () => deleteCollection({
            prefix,
            collectionName: get(collection, 'name'),
            collectionVersion: get(collection, 'version'),
          }),
        ],
        { stopOnError: false }
      ).catch(console.error);
    });

    it('ingested granule is archived', () => {
      if (beforeAllFailed) fail('beforeAll() failed');
      else {
        expect(ingestedGranule).toBeTruthy();
      }
    });

    it('returns a status code of 202', () => {
      if (beforeAllFailed) fail('beforeAll() failed');
      else {
        expect(postBulkGranulesResponse.statusCode).toEqual(202);
      }
    });

    it('returns an Async Operation Id', () => {
      if (beforeAllFailed) fail('beforeAll() failed');
      else {
        expect(isValidAsyncOperationId(postBulkOperationsBody.id)).toBeTrue();
      }
    });

    it('creates an AsyncOperation', async () => {
      if (beforeAllFailed) fail('beforeAll() failed');
      else {
        const asyncOperation = await getAsyncOperation({
          prefix,
          asyncOperationId: postBulkOperationsBody.id,
        });
        expect(asyncOperation.id).toEqual(postBulkOperationsBody.id);
      }
    });

    it('runs an ECS task', async () => {
      if (beforeAllFailed) fail('beforeAll() failed');
      else {
        // Verify that the task ARN exists in that cluster
        const describeTasksResponse = await ecs().describeTasks({
          cluster: clusterArn,
          tasks: [taskArn],
        }).promise();

        expect(describeTasksResponse.tasks.length).toEqual(1);
      }
    });

    it('eventually generates the correct output', async () => {
      if (beforeAllFailed) fail('beforeAll() failed');
      else {
        await ecs().waitFor(
          'tasksStopped',
          {
            cluster: clusterArn,
            tasks: [taskArn],
          }
        ).promise();

        const asyncOperation = await getAsyncOperation({
          prefix,
          asyncOperationId: postBulkOperationsBody.id,
        });

        expect(asyncOperation.status).toEqual('SUCCEEDED');

        let output;
        try {
          output = JSON.parse(asyncOperation.output);
        } catch (error) {
          throw new SyntaxError(`asyncOperation.output is not valid JSON: ${asyncOperation.output}`);
        }

        await getGranuleWithStatus({
          prefix,
          granuleId: JSON.parse(asyncOperation.output)[0],
          status: 'running',
          timeout: 120,
          updatedAt: ingestedGranule.updatedAt,
        });
        expect(output).toEqual([granuleId]);
      }
    });

    it('starts a workflow with an execution message referencing the correct queue URL', async () => {
      if (beforeAllFailed) fail('beforeAll() failed');
      else {
        // Find the execution ARN
        bulkOperationExecutionArn = await findExecutionArn(
          prefix,
          (execution) => {
            const asyncOperationId = get(execution, 'asyncOperationId');
            return asyncOperationId === postBulkOperationsBody.id;
          },
          {
            timestamp__from: bulkRequestTime,
            asyncOperationId: postBulkOperationsBody.id,
          },
          { timeout: 60 }
        );
        console.log('bulkOperationExecutionArn', bulkOperationExecutionArn);

        // Wait for the execution to be completed
        await getExecutionWithStatus({
          prefix,
          arn: bulkOperationExecutionArn,
          status: 'completed',
          timeout: 60,
        });

        const executionInput = await getExecutionInputObject(bulkOperationExecutionArn);
        expect(executionInput.cumulus_meta.queueUrl).toBe(scheduleQueueUrl);
      }
    });
  });
});

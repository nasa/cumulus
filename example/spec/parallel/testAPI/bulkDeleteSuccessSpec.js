'use strict';

const get = require('lodash/get');
const pAll = require('p-all');

const { deleteAsyncOperation, getAsyncOperation } = require('@cumulus/api-client/asyncOperations');
const granules = require('@cumulus/api-client/granules');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteExecution } = require('@cumulus/api-client/executions');
const { deleteProvider } = require('@cumulus/api-client/providers');
const { deleteRule } = require('@cumulus/api-client/rules');
const { ecs } = require('@cumulus/aws-client/services');
const {
  s3PutObject,
  getJsonS3Object,
  waitForObjectToExist,
} = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');
const {
  getClusterArn,
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

describe('POST /granules/bulkDelete', () => {
  let config;
  let clusterArn;
  let prefix;
  let timestampBeforeCall;

  beforeAll(async () => {
    config = await loadConfig();
    prefix = config.stackName;
    process.env.stackName = config.stackName;
    process.env.system_bucket = config.bucket;

    // Figure out what cluster we're using
    clusterArn = await getClusterArn(config.stackName);
    if (!clusterArn) throw new Error('Unable to find ECS cluster');
  });

  describe('deletes a published granule', () => {
    let beforeAllSucceeded = false;
    let ingestGranuleExecution1Arn;
    let postBulkDeleteResponse;
    let postBulkDeleteBody;
    let taskArn;
    let collection;
    let provider;
    let ingestGranuleRule;
    let granuleId;
    let ingestedGranule;

    beforeAll(async () => {
      try {
        const sourceBucket = config.bucket;
        const testId = createTimestampedTestId(config.stackName, 'bulkDeleteSuccess');
        const testSuffix = createTestSuffix(testId);

        // The S3 path where granules will be ingested from
        const sourcePath = `${prefix}/tmp/${testSuffix}`;

        // Create the collection
        // NOTE: Have to use a collection name/version (minus the suffix)
        // that is in CMR for the publishing steps in the workflow to succeed
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
        const granuleToDelete = {
          granuleId,
          dataType: collection.name,
          version: collection.version,
          files: [
            {
              name: filename,
              path: sourcePath,
            },
          ],
        };
        ingestGranuleRule = await createOneTimeRule(
          prefix,
          {
            workflow: 'IngestAndPublishGranule',
            collection: {
              name: collection.name,
              version: collection.version,
            },
            provider: provider.id,
            payload: {
              testExecutionId,
              granules: [granuleToDelete],
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

        // Wait for the execution to be completed
        await getExecutionWithStatus({
          prefix,
          arn: ingestGranuleExecution1Arn,
          status: 'completed',
          timeout: 60,
        });

        // Wait for the granule to be fully ingested
        ingestedGranule = await getGranuleWithStatus({ prefix, granuleId, status: 'completed' });
        timestampBeforeCall = Date.now();
        postBulkDeleteResponse = await granules.bulkDeleteGranules(
          {
            prefix,
            body: {
              granules: [{ granuleId, collectionId: constructCollectionId(collection.name, collection.version) }],
              // required to force removal of granules from CMR before deletion
              forceRemoveFromCmr: true,
            },
          }
        );
        postBulkDeleteBody = JSON.parse(postBulkDeleteResponse.body);

        // Query the AsyncOperation API to get the task ARN
        const asyncOperation = await getAsyncOperation(
          {
            prefix,
            asyncOperationId: postBulkDeleteBody.id,
          }
        );
        ({ taskArn } = asyncOperation);
        beforeAllSucceeded = true;
      } catch (error) {
        console.log(error);
      }
    });

    afterAll(async () => {
      // Must delete rules and executions before deleting associated collection and provider
      await deleteRule(
        { prefix, ruleName: get(ingestGranuleRule, 'name') }
      );
      await deleteExecution(
        { prefix: config.stackName, executionArn: ingestGranuleExecution1Arn }
      );

      if (postBulkDeleteBody.id) {
        await deleteAsyncOperation(
          { prefix: config.stackName, asyncOperationId: postBulkDeleteBody.id }
        );
      }

      await pAll(
        [
          () => deleteProvider(
            { prefix, providerId: get(provider, 'id') }
          ),
          () => deleteCollection(
            {
              prefix,
              collectionName: get(collection, 'name'),
              collectionVersion: get(collection, 'version'),
            }
          ),
        ],
        { stopOnError: false }
      ).catch(console.error);
    });

    it('ingested granule is published', () => {
      expect(beforeAllSucceeded).toBeTrue();
      expect(ingestedGranule.published).toBeTrue();
      // expect(ingestedGranule.cmrLink.includes('cmr.uat')).toBeTrue();
    });

    it('returns a status code of 202', () => {
      expect(beforeAllSucceeded).toBeTrue();
      expect(postBulkDeleteResponse.statusCode).toEqual(202);
    });

    it('returns an Async Operation Id', () => {
      expect(beforeAllSucceeded).toBeTrue();
      expect(isValidAsyncOperationId(postBulkDeleteBody.id)).toBeTrue();
      console.log(`Bulk delete async operation id: ${postBulkDeleteBody.id}`);
    });

    it('creates an AsyncOperation', async () => {
      expect(beforeAllSucceeded).toBeTrue();

      const asyncOperation = await getAsyncOperation({
        prefix,
        asyncOperationId: postBulkDeleteBody.id,
      });

      expect(asyncOperation.id).toEqual(postBulkDeleteBody.id);
    });

    it('runs an ECS task', async () => {
      expect(beforeAllSucceeded).toBeTrue();

      console.log(taskArn);
      // Verify that the task ARN exists in that cluster
      const describeTasksResponse = await ecs().describeTasks({
        cluster: clusterArn,
        tasks: [taskArn],
      }).promise();
      console.log(describeTasksResponse);
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
        prefix,
        asyncOperationId: postBulkDeleteBody.id,
      });
      expect(asyncOperation.status).toEqual('SUCCEEDED');

      let output;
      try {
        output = JSON.parse(asyncOperation.output);
      } catch (error) {
        throw new SyntaxError(`asyncOperation.output is not valid JSON: ${asyncOperation.output}`);
      }

      expect(output).toEqual({ deletedGranules: [granuleId] });
    });

    it('publishes a record to the granules reporting SNS topic on behalf of the deleted granule', async () => {
      expect(beforeAllSucceeded).toBeTrue();
      const granuleKey = `${config.stackName}/test-output/${granuleId}-${ingestedGranule.status}-Delete.output`;
      await expectAsync(waitForObjectToExist({
        bucket: config.bucket,
        key: granuleKey,
      })).toBeResolved();
      const savedEvent = await getJsonS3Object(config.bucket, granuleKey);
      const message = JSON.parse(savedEvent.Records[0].Sns.Message);

      const expectedGranuleAfterDeletion = {
        ...ingestedGranule,
        published: false,
        updatedAt: message.record.updatedAt,
        productionDateTime: message.record.productionDateTime,
        beginningDateTime: message.record.beginningDateTime,
        lastUpdateDateTime: message.record.lastUpdateDateTime,
      };
      delete expectedGranuleAfterDeletion.cmrLink;

      expect(message.event).toEqual('Delete');
      expect(message.record).toEqual(expectedGranuleAfterDeletion);
      expect(message.deletedAt).toBeGreaterThan(timestampBeforeCall);
    });
  });
});

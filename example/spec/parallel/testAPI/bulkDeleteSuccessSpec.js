'use strict';

const get = require('lodash/get');
const pAll = require('p-all');

const granules = require('@cumulus/api-client/granules');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteProvider } = require('@cumulus/api-client/providers');
const { deleteRule } = require('@cumulus/api-client/rules');
const { ecs } = require('@cumulus/aws-client/services');
const { s3PutObject } = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');
const {
  api: apiTestUtils,
  getClusterArn
} = require('@cumulus/integration-tests');
const { createCollection } = require('@cumulus/integration-tests/Collections');
const {
  findExecutionArn, getExecutionWithStatus
} = require('@cumulus/integration-tests/Executions');
const { getGranuleWithStatus } = require('@cumulus/integration-tests/Granules');
const { createProvider } = require('@cumulus/integration-tests/Providers');
const { createOneTimeRule } = require('@cumulus/integration-tests/Rules');

const {
  createTimestampedTestId,
  createTestSuffix,
  loadConfig
} = require('../../helpers/testUtils');

describe('POST /granules/bulkDelete', () => {
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

  describe('deletes a published granule', () => {
    let beforeAllSucceeded = false;
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
          version: '006'
        };
        collection = await createCollection(
          prefix,
          {
            ...cmrCollection,
            duplicateHandling: 'error',
            process: 'modis'
          }
        );

        // Create the S3 provider
        provider = await createProvider(prefix, { host: sourceBucket });

        const filename = `${randomId('file')}.txt`;
        const fileKey = `${sourcePath}/${filename}`;
        await s3PutObject({
          Bucket: sourceBucket,
          Key: fileKey,
          Body: 'asdf'
        });

        granuleId = randomId('granule-id-');

        const ingestTime = Date.now() - 1000 * 30;

        // Ingest the granule the first time
        const testExecutionId = randomId('test-execution-');
        ingestGranuleRule = await createOneTimeRule(
          prefix,
          {
            workflow: 'IngestAndPublishGranule',
            collection: {
              name: collection.name,
              version: collection.version
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
                      path: sourcePath
                    }
                  ]
                }
              ]
            }
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
          timeout: 60
        });

        // Wait for the granule to be fully ingested
        ingestedGranule = await getGranuleWithStatus({ prefix, granuleId, status: 'completed' });

        postBulkDeleteResponse = await granules.bulkDeleteGranules({
          prefix,
          body: {
            ids: [granuleId],
            // required to force removal of granules from CMR before deletion
            forceRemoveFromCmr: true
          }
        });
        postBulkDeleteBody = JSON.parse(postBulkDeleteResponse.body);

        // Query the AsyncOperation API to get the task ARN
        const getAsyncOperationResponse = await apiTestUtils.getAsyncOperation({
          prefix,
          id: postBulkDeleteBody.id
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
            collectionVersion: get(collection, 'version')
          })
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
      expect(postBulkDeleteBody.id).toMatch(/[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}/);
    });

    it('creates an AsyncOperation', async () => {
      expect(beforeAllSucceeded).toBeTrue();

      const getAsyncOperationResponse = await apiTestUtils.getAsyncOperation({
        prefix,
        id: postBulkDeleteBody.id
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
        tasks: [taskArn]
      }).promise();

      expect(describeTasksResponse.tasks.length).toEqual(1);
    });

    it('eventually generates the correct output', async () => {
      expect(beforeAllSucceeded).toBeTrue();

      await ecs().waitFor(
        'tasksStopped',
        {
          cluster: clusterArn,
          tasks: [taskArn]
        }
      ).promise();

      const getAsyncOperationResponse = await apiTestUtils.getAsyncOperation({
        prefix,
        id: postBulkDeleteBody.id
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

      expect(output).toEqual({ deletedGranules: [granuleId] });
    });
  });
});

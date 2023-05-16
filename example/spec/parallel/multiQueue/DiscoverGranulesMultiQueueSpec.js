'use strict';

const get = require('lodash/get');
const { s3PutObject } = require('@cumulus/aws-client/S3');
const {
  getExecutionInputObject,
  waitForCompletedExecution,
} = require('@cumulus/integration-tests');
const { createCollection } = require('@cumulus/integration-tests/Collections');
const { findExecutionArn } = require('@cumulus/integration-tests/Executions');
const { createProvider } = require('@cumulus/integration-tests/Providers');
const { createOneTimeRule } = require('@cumulus/integration-tests/Rules');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { getExecution, deleteExecution } = require('@cumulus/api-client/executions');
const { getGranule } = require('@cumulus/api-client/granules');
const { deleteProvider } = require('@cumulus/api-client/providers');
const { deleteRule } = require('@cumulus/api-client/rules');
const { constructCollectionId } = require('@cumulus/message/Collections');
const {
  waitForApiStatus,
} = require('../../helpers/apiUtils');
const {
  waitForGranuleAndDelete,
} = require('../../helpers/granuleUtils');
const {
  createTimestampedTestId,
  deleteFolder,
  loadConfig,
} = require('../../helpers/testUtils');

describe('The DiscoverGranules workflow', () => {
  let beforeAllError;
  let bucket;
  let collection;
  let discoverGranulesRule;
  let ingestGranuleExecutionArn;
  let provider;
  let sourcePath;
  let discoverGranulesOutput;
  let queueGranulesOutput;
  let stackName;
  let testGranuleIds;
  let discoverGranulesExecutionArn;

  beforeAll(async () => {
    try {
      ({ stackName, bucket } = await loadConfig());

      process.env.stackName = stackName;
      process.env.system_bucket = bucket;

      const testId = createTimestampedTestId(stackName, 'DiscoverGranuleS3MultiQueue');

      // The S3 path where granules will be ingested from
      sourcePath = `${stackName}/tmp/${testId}`;

      // Create the collection
      collection = await createCollection(stackName);

      // Create the provider
      provider = await createProvider(stackName, { host: bucket });

      // Upload the test data to S3
      testGranuleIds = [`${testId}-granule1`, `${testId}-granule2`, `${testId}-granule3`];
      await Promise.all(
        testGranuleIds.map(async (granId) => {
          const key = `${sourcePath}/${granId}.nc`;
          await s3PutObject({
            Bucket: bucket,
            Key: key,
            Body: 'asdf',
          });
        })
      );

      const ingestTime = Date.now() - 1000 * 30;

      // Execute the DiscoverGranules workflow
      discoverGranulesRule = await createOneTimeRule(
        stackName,
        {
          workflow: 'DiscoverGranules',
          collection: {
            name: collection.name,
            version: collection.version,
          },
          provider: provider.id,
          meta: {
            provider_path: `${sourcePath}/`,
            queueBatchSize: 3,
          },
          payload: {
            testExecutionId: testId,
          },
        }
      );

      discoverGranulesExecutionArn = await findExecutionArn(
        stackName,
        (execution) =>
          get(execution, 'originalPayload.testExecutionId') === discoverGranulesRule.payload.testExecutionId,
        {
          timestamp__from: ingestTime,
          'originalPayload.testExecutionId': discoverGranulesRule.payload.testExecutionId,
        },
        { timeout: 30 }
      );

      await waitForApiStatus(
        getExecution,
        {
          prefix: stackName,
          arn: discoverGranulesExecutionArn,
        },
        'completed'
      );

      const lambdaStep = new LambdaStep();

      discoverGranulesOutput = await lambdaStep.getStepOutput(
        discoverGranulesExecutionArn,
        'DiscoverGranules'
      );

      // Get the output of the QueueGranules task. Doing it here because there are
      // two tests that need it.
      queueGranulesOutput = await lambdaStep.getStepOutput(
        discoverGranulesExecutionArn,
        'QueueGranules'
      );
    } catch (error) {
      beforeAllError = error;
    }
  });

  afterAll(async () => {
    await Promise.all(discoverGranulesOutput.payload.granules.map(
      async (granule) => {
        await waitForGranuleAndDelete(
          stackName,
          granule.granuleId,
          constructCollectionId(collection.name, collection.version),
          'completed'
        );
      }
    ));

    await Promise.all([
      waitForApiStatus(
        getExecution,
        { prefix: stackName, arn: ingestGranuleExecutionArn },
        'completed'
      ),
      waitForApiStatus(
        getExecution,
        { prefix: stackName, arn: discoverGranulesExecutionArn },
        'completed'
      ),
    ]);
    // The order of execution deletes matters. Children must be deleted before parents.
    await deleteExecution({ prefix: stackName, executionArn: ingestGranuleExecutionArn });
    await deleteExecution({ prefix: stackName, executionArn: discoverGranulesExecutionArn });
    await deleteRule({ prefix: stackName, ruleName: discoverGranulesRule.name });
    await Promise.all([
      deleteFolder(bucket, sourcePath),
      deleteCollection({
        prefix: stackName,
        collectionName: collection.name,
        collectionVersion: collection.version,
      }),
      deleteProvider({
        prefix: stackName,
        providerId: provider.id,
      }),
    ]);
  });

  it('DiscoverGranules outputs the list of discovered granules', () => {
    if (beforeAllError) fail(beforeAllError);
    else {
      expect(discoverGranulesOutput.payload.granules.length).toEqual(3);
      discoverGranulesOutput.payload.granules.forEach((granule) => {
        expect(granule.dataType).toEqual(collection.name);
        expect(granule.version).toEqual(collection.version);
        expect(granule.files.length).toEqual(1);
      });
    }
  });

  it('QueueGranules queues the granules into one workflow', async () => {
    if (beforeAllError) fail(beforeAllError);
    else {
      expect(queueGranulesOutput.payload.running.length).toEqual(1);
      ingestGranuleExecutionArn = queueGranulesOutput.payload.running[0];
      const executionInput = await getExecutionInputObject(queueGranulesOutput.payload.running[0]);
      expect(executionInput.payload.granules.length).toEqual(3);
    }
  });

  it('results in a successful IngestGranule workflow execution', async () => {
    if (beforeAllError) fail(beforeAllError);
    else {
      const ingestGranuleExecutionStatus = await waitForCompletedExecution(
        queueGranulesOutput.payload.running[0]
      );
      expect(ingestGranuleExecutionStatus).toEqual('SUCCEEDED');
    }
  });

  it('granules become available in the Cumulus API', async () => {
    if (beforeAllError) fail(beforeAllError);
    else {
      const granules = await Promise.all(testGranuleIds.map((granuleId) => waitForApiStatus(
        getGranule,
        { prefix: stackName, granuleId, collectionId: constructCollectionId(collection.name, collection.version) },
        'completed'
      )));
      granules.forEach((g) => {
        expect(g).toBeDefined();
      });
    }
  });
});

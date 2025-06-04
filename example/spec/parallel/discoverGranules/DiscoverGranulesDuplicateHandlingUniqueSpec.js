'use strict';

const {
  loadCollection,
  loadProvider,
} = require('@cumulus/integration-tests');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const {
  createCollection,
  deleteCollection,
} = require('@cumulus/api-client/collections');
const { getExecution, deleteExecution } = require('@cumulus/api-client/executions');
const {
  createProvider,
  deleteProvider,
} = require('@cumulus/api-client/providers');
const { constructCollectionId } = require('@cumulus/message/Collections');

const {
  waitForApiStatus,
} = require('../../helpers/apiUtils');
const {
  uploadS3GranuleDataForDiscovery,
} = require('../../helpers/discoverUtils');
const {
  waitForGranuleAndDelete,
} = require('../../helpers/granuleUtils');
const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const {
  createTimestampedTestId,
  deleteFolder,
  loadConfig,
} = require('../../helpers/testUtils');

describe('Ingesting duplicate granules using DiscoverGranules', () => {
  let beforeAllError;
  let bucket;
  let collection;
  let ingestGranuleExecutionArn;
  let provider;
  let providerPath;
  let discoverGranulesOutput;
  let stackName;
  let workflowExecution;

  beforeAll(async () => {
    try {
      ({ stackName, bucket } = await loadConfig());

      process.env.stackName = stackName;
      process.env.system_bucket = bucket;

      const testId = createTimestampedTestId(stackName, 'DiscoverGranuleS3Success');

      // Create the provider
      provider = await loadProvider({
        filename: './data/providers/s3/s3_provider.json',
        postfix: testId,
        s3Host: bucket,
      });
      await createProvider({ prefix: stackName, provider });

      // Create the collection
      collection = await loadCollection({
        filename: './data/collections/s3_MOD09GQ_006/s3_MOD09GQ_006.json',
        postfix: testId,
      });

      await createCollection({ prefix: stackName, collection });

      providerPath = `cumulus-test-data/${testId}`;

      // Upload granules to be discovered
      await uploadS3GranuleDataForDiscovery({
        bucket,
        prefix: providerPath,
      });

      // Execute the DiscoverGranules workflow
      workflowExecution = await buildAndExecuteWorkflow(
        stackName,
        bucket,
        'DiscoverGranules',
        collection,
        provider,
        undefined,
        { provider_path: providerPath }
      );

      const lambdaStep = new LambdaStep();

      discoverGranulesOutput = await lambdaStep.getStepOutput(
        workflowExecution.executionArn,
        'DiscoverGranules'
      );

      // Get the output of the QueueGranules task. Doing it here because there are
      // two tests that need it.
      await lambdaStep.getStepOutput(
        workflowExecution.executionArn,
        'QueueGranules'
      );
    } catch (error) {
      beforeAllError = error;
      throw error;
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
        { prefix: stackName, arn: workflowExecution.executionArn },
        'completed'
      ),
    ]);
    // The order of execution deletes matters. Children must be deleted before parents.
    await deleteExecution({ prefix: stackName, executionArn: ingestGranuleExecutionArn });
    await deleteExecution({ prefix: stackName, executionArn: workflowExecution.executionArn });
    await Promise.all([
      deleteFolder(bucket, providerPath),
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

  describe('The DiscoverGranules workflow with unique granule handling', () => {
    it('prepares the test suite successfully', () => {
      if (beforeAllError) fail(beforeAllError);
    });
    xit('executes successfully', async () => {});
    xit('results in a successful IngestGranule workflow execution', async () => {});
    xit('it makes the granule available via the Cumulus API', async () => {});
    xit('it publishes the granule metadata to CMR', async () => {});
  });

  // TODO: do we need all of these assertions for the second workflow execution?
  //  Do we want to just include the duplicate granule in the above workflow execution?
  describe('The DiscoverGranules workflow ingests a second granule with the same producerGranuleId but different collection', () => {
    xit('executes successfully', async () => {});
    xit('results in a successful IngestGranule workflow execution', async () => {});
    xit('it makes the granule available via the Cumulus API', async () => {});
    xit('it publishes the granule metadata to CMR', async () => {});
  });

  describe('The add-unique-granuleID task', () => {
    xit('it updates the Cumulus Message with the appropriate granuleId and providerGranuleId', async () => {});
    xit('it updates the CMR metadata with the appropriate granuleId and providerGranuleId', async () => {});
  });
});

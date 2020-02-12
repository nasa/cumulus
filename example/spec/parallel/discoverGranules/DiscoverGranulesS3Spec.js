'use strict';

const pWaitFor = require('p-wait-for');
const { randomString } = require('@cumulus/common/test-utils');
const {
  buildAndExecuteWorkflow,
  loadCollection,
  loadProvider,
  waitForCompletedExecution
} = require('@cumulus/integration-tests');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const {
  createCollection, deleteCollection
} = require('@cumulus/integration-tests/api/collections');
const { getExecution } = require('@cumulus/integration-tests/api/executions');
const {
  createProvider, deleteProvider
} = require('@cumulus/integration-tests/api/providers');
const {
  deleteFolder, loadConfig, updateAndUploadTestDataToBucket
} = require('../../helpers/testUtils');

describe('The DiscoverGranules workflow', () => {
  let beforeAllCompleted = false;
  let collection;
  let discoverGranulesOutput;
  let executionFromApi;
  let ingestGranuleExecutionStatus;
  let queueGranulesOutput;
  let workflowExecution;

  beforeAll(async () => {
    const config = await loadConfig();

    const testId = randomString();

    // Create the provider
    const provider = await loadProvider({
      filename: './data/providers/s3/s3_provider.json',
      postfix: testId,
      s3Host: config.bucket
    });
    await createProvider(config.stackName, provider);

    // Create the collection
    const loadedCollection = await loadCollection({
      filename: './data/collections/s3_MOD09GQ_006/s3_MOD09GQ_006.json',
      postfix: testId
    });

    collection = {
      ...loadedCollection,
      provider_path: `cumulus-test-data/${testId}`
    };

    await createCollection(config.stackName, collection);

    // Upload the granule to be discovered
    await updateAndUploadTestDataToBucket(
      config.bucket,
      [
        '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
        '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
        '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg'
      ],
      collection.provider_path
    );

    // Execute the DiscoverGranules workflow
    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      'DiscoverGranules',
      collection,
      provider
    );

    // Wait for the execution to become available through the API
    try {
      await pWaitFor(
        async () => {
          executionFromApi = await getExecution({
            prefix: config.stackName,
            arn: workflowExecution.executionArn
          });

          return executionFromApi.status === 'completed';
        },
        { interval: 2000, timeout: 60000 }
      );
    } catch (err) {
      console.log('Execution was never updated to "completed" in the API');
    }

    // Get the output of the DiscoverGranules task
    const lambdaStep = new LambdaStep();
    discoverGranulesOutput = await lambdaStep.getStepOutput(
      workflowExecution.executionArn,
      'DiscoverGranules'
    );

    // Get the output of the QueueGranules task
    queueGranulesOutput = await lambdaStep.getStepOutput(
      workflowExecution.executionArn,
      'QueueGranules'
    );

    // Get the status of the resulting IngestGranule execution
    ingestGranuleExecutionStatus = await waitForCompletedExecution(
      queueGranulesOutput.payload.running[0]
    );

    // Clean up
    await deleteFolder(config.bucket, collection.provider_path);
    await deleteCollection(config.stackName, collection.name, collection.version);
    await deleteProvider(config.stackName, provider.id);

    beforeAllCompleted = true;
  });

  it('executes successfully', () => {
    if (!beforeAllCompleted) fail('beforeAll() failed');
    else expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  it('can be fetched from the API', () => {
    if (!beforeAllCompleted) fail('beforeAll() failed');
    else expect(executionFromApi.status).toEqual('completed');
  });

  it('results in a successful IngestGranule workflow execution', () => {
    if (!beforeAllCompleted) fail('beforeAll() failed');
    else expect(ingestGranuleExecutionStatus).toEqual('SUCCEEDED');
  });

  describe('DiscoverGranules task', () => {
    it('outputs the list of discovered granules', () => {
      if (!beforeAllCompleted) fail('beforeAll() failed');
      else {
        expect(discoverGranulesOutput.payload.granules.length).toEqual(1);
        const granule = discoverGranulesOutput.payload.granules[0];
        expect(granule.granuleId).toEqual('MOD09GQ.A2016358.h13v04.006.2016360104606');
        expect(granule.dataType).toEqual(collection.name);
        expect(granule.version).toEqual(collection.version);
        expect(granule.files.length).toEqual(3);
      }
    });
  });

  describe('QueueGranules task', () => {
    it('has queued the granule', () => {
      if (!beforeAllCompleted) fail('beforeAll() failed');
      else expect(queueGranulesOutput.payload.running.length).toEqual(1);
    });
  });
});

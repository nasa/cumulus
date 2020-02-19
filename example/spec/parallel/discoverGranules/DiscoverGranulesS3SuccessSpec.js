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
  let provider;
  let queueGranulesOutput;
  let workflowExecution;
  let stackName;
  let bucket;

  beforeAll(async () => {
    ({ stackName, bucket } = await loadConfig());

    process.env.ProvidersTable = `${stackName}-ProvidersTable`;

    const testId = randomString();

    // Create the provider
    provider = await loadProvider({
      filename: './data/providers/s3/s3_provider.json',
      postfix: testId,
      s3Host: bucket
    });
    await createProvider(stackName, provider);

    // Create the collection
    const loadedCollection = await loadCollection({
      filename: './data/collections/s3_MOD09GQ_006/s3_MOD09GQ_006.json',
      postfix: testId
    });

    collection = {
      ...loadedCollection,
      provider_path: `cumulus-test-data/${testId}`
    };
    await createCollection(stackName, collection);

    // Upload the granule to be discovered
    await updateAndUploadTestDataToBucket(
      bucket,
      [
        '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
        '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
        '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg'
      ],
      collection.provider_path
    );

    // Execute the DiscoverGranules workflow
    workflowExecution = await buildAndExecuteWorkflow(
      stackName,
      bucket,
      'DiscoverGranules',
      collection,
      provider
    );

    // Get the output of the QueueGranules task. Doing it here because there are
    // two tests that need it.
    queueGranulesOutput = await (new LambdaStep()).getStepOutput(
      workflowExecution.executionArn,
      'QueueGranules'
    );

    beforeAllCompleted = true;
  });

  afterAll(() =>
    Promise.all([
      deleteFolder(bucket, collection.provider_path),
      deleteCollection(stackName, collection.name, collection.version),
      deleteProvider(stackName, provider.id)
    ]));

  it('executes successfully', () => {
    if (!beforeAllCompleted) fail('beforeAll() failed');
    else expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  it('can be fetched from the API', async () => {
    if (!beforeAllCompleted) fail('beforeAll() failed');
    else {
      await expectAsync(
        pWaitFor(
          async () => {
            const { status } = await getExecution({
              prefix: stackName,
              arn: workflowExecution.executionArn
            });

            return status === 'completed';
          },
          { interval: 2000, timeout: 60000 }
        )
      ).toBeResolved();
    }
  });

  it('results in a successful IngestGranule workflow execution', async () => {
    if (!beforeAllCompleted) fail('beforeAll() failed');
    else {
      const ingestGranuleExecutionStatus = await waitForCompletedExecution(
        queueGranulesOutput.payload.running[0]
      );
      expect(ingestGranuleExecutionStatus).toEqual('SUCCEEDED');
    }
  });

  describe('DiscoverGranules task', () => {
    it('outputs the list of discovered granules', async () => {
      if (!beforeAllCompleted) fail('beforeAll() failed');
      else {
        const discoverGranulesOutput = await (new LambdaStep()).getStepOutput(
          workflowExecution.executionArn,
          'DiscoverGranules'
        );

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

'use strict';

const { randomString } = require('@cumulus/common/test-utils');
const {
  buildAndExecuteWorkflow,
  loadCollection,
  loadProvider,
  waitForStartedExecution,
} = require('@cumulus/integration-tests');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const {
  createCollection, deleteCollection,
} = require('@cumulus/api-client/collections');
const {
  createProvider, deleteProvider,
} = require('@cumulus/api-client/providers');
const {
  deleteFolder, loadConfig, updateAndUploadTestDataToBucket,
} = require('../../helpers/testUtils');

describe('The DiscoverGranules workflow', () => {
  let beforeAllCompleted = false;
  let collection;
  let provider;
  let queueGranulesOutput;
  let workflowExecution;
  let stackName;
  let bucket;
  let providerPath;
  let executionNamePrefix;

  beforeAll(async () => {
    ({ stackName, bucket } = await loadConfig());

    process.env.stackName = stackName;
    process.env.system_bucket = bucket;

    process.env.ProvidersTable = `${stackName}-ProvidersTable`;

    const testId = randomString();

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

    // Upload the granule to be discovered
    await updateAndUploadTestDataToBucket(
      bucket,
      [
        '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
        '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
        '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg',
      ],
      providerPath
    );

    executionNamePrefix = randomString(3);

    // Execute the DiscoverGranules workflow
    workflowExecution = await buildAndExecuteWorkflow(
      stackName,
      bucket,
      'DiscoverGranulesWithExecutionNamePrefix',
      collection,
      provider,
      undefined,
      {
        provider_path: providerPath,
        executionNamePrefix,
      }
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
      deleteFolder(bucket, providerPath),
      deleteCollection({
        prefix: stackName,
        collectionName: collection.name,
        collectionVersion: collection.version,
      }),
      deleteProvider({
        prefix: stackName,
        provider: provider.id,
      }),
    ]));

  it('executes successfully', () => {
    if (!beforeAllCompleted) fail('beforeAll() failed');
    else expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  it('properly sets the name of the queued execution', () => {
    if (!beforeAllCompleted) fail('beforeAll() failed');
    else {
      const executionArn = queueGranulesOutput.payload.running[0];

      const executionName = executionArn.split(':').reverse()[0];

      expect(executionName.startsWith(executionNamePrefix)).toBeTrue();
    }
  });

  it('results in an IngestGranule workflow execution', async () => {
    if (!beforeAllCompleted) fail('beforeAll() failed');
    else {
      const executionArn = queueGranulesOutput.payload.running[0];
      await expectAsync(waitForStartedExecution(executionArn)).toBeResolved();
    }
  });
});

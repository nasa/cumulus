'use strict';

const pAll = require('p-all');

const { randomString } = require('@cumulus/common/test-utils');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { deleteExecution } = require('@cumulus/api-client/executions');
const {
  loadCollection,
  loadProvider,
  waitForStartedExecution,
  waitForCompletedExecution,
} = require('@cumulus/integration-tests');
const {
  createCollection,
  deleteCollection,
} = require('@cumulus/api-client/collections');
const {
  createProvider,
  deleteProvider,
} = require('@cumulus/api-client/providers');

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
  let parentExecutionArn;
  let expectedGranuleId;

  beforeAll(async () => {
    ({ stackName, bucket } = await loadConfig());

    process.env.stackName = stackName;
    process.env.system_bucket = bucket;

    const testId = createTimestampedTestId(stackName, 'DiscoverGranulesWithExecutionNamePrefix');

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
    const { granuleId } = await uploadS3GranuleDataForDiscovery({
      bucket,
      prefix: providerPath,
    });
    expectedGranuleId = granuleId;

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

  afterAll(async () => {
    await Promise.all(
      queueGranulesOutput.payload.running
        .map((arn) => waitForCompletedExecution(arn))
    );
    await waitForCompletedExecution(parentExecutionArn);
    await waitForGranuleAndDelete(
      stackName,
      expectedGranuleId,
      'completed'
    );

    // The order of execution deletes matters. Parents must be deleted before children.
    await deleteExecution({ prefix: stackName, executionArn: parentExecutionArn });
    await deleteExecution({ prefix: stackName, executionArn: workflowExecution.executionArn });

    await pAll(
      [
        () => deleteFolder(bucket, providerPath),
        () => deleteCollection({
          prefix: stackName,
          collectionName: collection.name,
          collectionVersion: collection.version,
        }),
        () => deleteProvider({
          prefix: stackName,
          providerId: provider.id,
        }),
      ],
      { stopOnError: false }
    ).catch(console.error);
  });

  it('executes successfully', () => {
    if (!beforeAllCompleted) fail('beforeAll() failed');
    else expect(workflowExecution.status).toEqual('completed');
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
      parentExecutionArn = queueGranulesOutput.payload.running[0];
      await expectAsync(waitForStartedExecution(parentExecutionArn)).toBeResolved();
    }
  });
});

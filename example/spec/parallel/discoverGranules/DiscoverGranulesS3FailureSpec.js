'use strict';

const get = require('lodash/get');
const { randomString } = require('@cumulus/common/test-utils');
const {
  loadCollection,
  loadProvider,
} = require('@cumulus/integration-tests');
const {
  getExecutionWithStatus,
} = require('@cumulus/integration-tests/Executions');
const {
  createCollection, deleteCollection,
} = require('@cumulus/api-client/collections');
const { deleteExecution } = require('@cumulus/api-client/executions');
const {
  createProvider, deleteProvider,
} = require('@cumulus/api-client/providers');

const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const {
  loadConfig,
  createTimestampedTestId,
} = require('../../helpers/testUtils');

describe('The DiscoverGranules workflow with a non-existent bucket', () => {
  let beforeAllCompleted = false;
  let collection;
  let provider;
  let workflowExecution;
  let stackName;
  let bucket;

  beforeAll(async () => {
    ({ stackName, bucket } = await loadConfig());

    process.env.stackName = stackName;
    process.env.system_bucket = bucket;

    const testId = createTimestampedTestId(stackName, 'DiscoverGranulesS3Failure');

    // Create the provider
    provider = await loadProvider({
      filename: './data/providers/s3/s3_provider.json',
      postfix: testId,
      s3Host: randomString(),
    });
    await createProvider({ prefix: stackName, provider });
    // Create the collection
    collection = await loadCollection({
      filename: './data/collections/s3_MOD09GQ_006/s3_MOD09GQ_006.json',
      postfix: testId,
    });

    await createCollection({ prefix: stackName, collection });

    // Execute the DiscoverGranules workflow
    workflowExecution = await buildAndExecuteWorkflow(
      stackName,
      bucket,
      'DiscoverGranules',
      collection,
      provider,
      undefined,
      { provider_path: 'cumulus-test-data/pdrs' }
    );

    beforeAllCompleted = true;
  });

  afterAll(async () => {
    await deleteExecution({ prefix: stackName, executionArn: workflowExecution.executionArn });
    await Promise.all([
      deleteCollection({
        prefix: stackName,
        collectionName: collection.name,
        collectionVersion: collection.version,
      }),
      deleteProvider({ prefix: stackName, providerId: provider.id }),
    ]);
  });

  it('fails', () => {
    if (!beforeAllCompleted) fail('beforeAll() failed');
    else expect(workflowExecution.status).toEqual('failed');
  });

  it('records the correct execution failure reason in the API', async () => {
    if (!beforeAllCompleted) fail('beforeAll() failed');
    else {
      const failedExecutionFromApi = await getExecutionWithStatus({
        prefix: stackName,
        arn: workflowExecution.executionArn,
        status: 'failed',
      });

      expect(
        get(failedExecutionFromApi, 'error.Error')
      ).toBe(
        'NoSuchBucket'
      );
    }
  });
});

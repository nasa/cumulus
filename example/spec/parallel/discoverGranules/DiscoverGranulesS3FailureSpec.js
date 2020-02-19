'use strict';

const pWaitFor = require('p-wait-for');
const { randomString } = require('@cumulus/common/test-utils');
const {
  buildAndExecuteWorkflow,
  loadCollection,
  loadProvider
} = require('@cumulus/integration-tests');
const {
  createCollection, deleteCollection
} = require('@cumulus/integration-tests/api/collections');
const { getExecution } = require('@cumulus/integration-tests/api/executions');
const {
  createProvider, deleteProvider
} = require('@cumulus/integration-tests/api/providers');
const { loadConfig } = require('../../helpers/testUtils');

describe('The DiscoverGranules workflow with a non-existent bucket', () => {
  let beforeAllCompleted = false;
  let collection;
  let provider;
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
      s3Host: randomString()
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

    // Execute the DiscoverGranules workflow
    workflowExecution = await buildAndExecuteWorkflow(
      stackName,
      bucket,
      'DiscoverGranules',
      collection,
      provider
    );

    beforeAllCompleted = true;
  });

  afterAll(() =>
    Promise.all([
      deleteCollection(stackName, collection.name, collection.version),
      deleteProvider(stackName, provider.id)
    ]));

  it('fails', () => {
    if (!beforeAllCompleted) fail('beforeAll() failed');
    else expect(workflowExecution.status).toEqual('FAILED');
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

            return status === 'failed';
          },
          { interval: 2000, timeout: 60000 }
        )
      ).toBeResolved();
    }
  });
});

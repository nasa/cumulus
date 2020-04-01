'use strict';

const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { deleteProvider } = require('@cumulus/api-client/providers');
const { deleteGranule, waitForGranule } = require('@cumulus/api-client/granules');

const {
  api: apiTestUtils,
  addCollections,
  buildAndExecuteWorkflow,
  cleanupCollections,
  waitForCompletedExecution
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  createTimestampedTestId,
  createTestSuffix
} = require('../../helpers/testUtils');

const workflowName = 'DiscoverGranules';
const { buildHttpProvider, createProvider } = require('../../helpers/Providers');
const updateCollectionDuplicateFlag = async (flag, collection, config) => {
  await apiTestUtils.updateCollection({
    prefix: config.stackName,
    collection,
    updateParams: {
      duplicateHandling: flag
    }
  });
};

const awaitIngestExecutions = async (workflowExecution, lambdaStep) => {
  const lambdaOutput = await lambdaStep.getStepOutput(
    workflowExecution.executionArn, 'QueueGranules'
  );
  const ingestExecutions = lambdaOutput.payload.running.map((e) => waitForCompletedExecution(e));
  return Promise.all(ingestExecutions);
};

describe('The Discover Granules workflow with http Protocol', () => {
  const collectionsDir = './data/collections/http_testcollection_002/';

  let collection;
  let config;
  let lambdaStep;
  let provider;
  let testId;
  let testSuffix;

  beforeAll(async () => {
    lambdaStep = new LambdaStep();
    config = await loadConfig();

    testId = createTimestampedTestId(config.stackName, 'DiscoverGranulesDuplicate');
    testSuffix = createTestSuffix(testId);
    collection = { name: `http_testcollection${testSuffix}`, version: '002' };
    provider = await buildHttpProvider(testSuffix);

    await Promise.all([
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      createProvider(config.stackName, provider)
    ]);

    collection = JSON.parse((await apiTestUtils.getCollection({
      prefix: config.stackName,
      collectionName: collection.name,
      collectionVersion: collection.version
    })).body);
  });

  afterAll(async () => {
    await Promise.all([
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      deleteProvider({ prefix: config.stackName, providerId: provider.id })
    ]);
  });


  describe('when the collection configured with duplicateHandling set to "skip" it:', () => {
    const expectedGranules = ['granule-4', 'granule-5', 'granule-6'];
    let ingestStatus;
    let httpWorkflowExecution;
    let originalHttpWorkflowExecution;
    beforeAll(async () => {
      await updateCollectionDuplicateFlag('replace', collection, config);

      originalHttpWorkflowExecution = await buildAndExecuteWorkflow(config.stackName,
        config.bucket, workflowName, collection, provider);

      ingestStatus = await awaitIngestExecutions(originalHttpWorkflowExecution, lambdaStep);

      const granuleStatusPromises = expectedGranules.map((g) =>
        waitForGranule({ prefix: config.stackName, granuleId: g }));
      await Promise.all(granuleStatusPromises);

      await deleteGranule({ prefix: config.stackName, granuleId: 'granule-4' });
      await updateCollectionDuplicateFlag('skip', collection, config);

      httpWorkflowExecution = await buildAndExecuteWorkflow(config.stackName,
        config.bucket, workflowName, collection, provider);
    });

    it('executes initial ingest successfully', () => {
      expect(originalHttpWorkflowExecution.status).toEqual('SUCCEEDED');
      expect(ingestStatus.every((e) => e === 'SUCCEEDED')).toEqual(true);
    });

    it('recieves an event with duplicateHandling set to skip', async () => {
      const lambdaInput = await lambdaStep.getStepInput(
        httpWorkflowExecution.executionArn, 'DiscoverGranules'
      );
      expect(lambdaInput.meta.collection.duplicateHandling).toEqual('skip');
    });

    it('executes successfully', () => {
      expect(httpWorkflowExecution.status).toEqual('SUCCEEDED');
    });

    it('discovers granules, but skips the granules as duplicates', async () => {
      const lambdaOutput = await lambdaStep.getStepOutput(
        httpWorkflowExecution.executionArn, 'DiscoverGranules'
      );
      expect(lambdaOutput.payload.granules.length).toEqual(1);
    });

    it('queues only one granule', async () => {
      const lambdaOutput = await lambdaStep.getStepOutput(
        httpWorkflowExecution.executionArn, 'QueueGranules'
      );
      expect(lambdaOutput.payload.running.length).toEqual(1);
    });
  });

  describe('when the collection configured with duplicateHandling set to "error" it:', () => {
    let ingestStatus;
    let httpWorkflowExecution;
    let originalHttpWorkflowExecution;
    beforeAll(async () => {
      try {
        const expectedGranules = ['granule-4', 'granule-5', 'granule-6'];
        await updateCollectionDuplicateFlag('replace', collection, config);

        originalHttpWorkflowExecution = await buildAndExecuteWorkflow(config.stackName,
          config.bucket, workflowName, collection, provider);

        ingestStatus = await awaitIngestExecutions(originalHttpWorkflowExecution, lambdaStep);
        const granuleStatusPromises = expectedGranules.map((g) =>
          waitForGranule({
            prefix: config.stackName, granuleId: g
          }));
        await Promise.all(granuleStatusPromises);

        await updateCollectionDuplicateFlag('error', collection, config);

        httpWorkflowExecution = await buildAndExecuteWorkflow(config.stackName,
          config.bucket, workflowName, collection, provider);
      } catch (e) {
        console.log(e);
        console.log(JSON.stringify(e));
        throw e;
      }
    });

    it('executes initial ingest successfully', () => {
      expect(originalHttpWorkflowExecution.status).toEqual('SUCCEEDED');
      expect(ingestStatus.every((e) => e === 'SUCCEEDED')).toEqual(true);
    });

    it('recieves an event with duplicateHandling set to error', async () => {
      const lambdaInput = await lambdaStep.getStepInput(
        httpWorkflowExecution.executionArn, 'DiscoverGranules'
      );
      expect(lambdaInput.meta.collection.duplicateHandling).toEqual('error');
    });

    it('fails', () => {
      expect(httpWorkflowExecution.status).toEqual('FAILED');
    });

    it('has the expected error', async () => {
      const lambdaOutput = await lambdaStep.getStepOutput(
        httpWorkflowExecution.executionArn, 'DiscoverGranules', 'failure'
      );
      const expectedSubString = 'Duplicate granule found';
      expect(JSON.parse(lambdaOutput.cause).errorMessage).toContain(expectedSubString);
    });
  });
});

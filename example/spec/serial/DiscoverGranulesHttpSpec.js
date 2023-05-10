'use strict';

const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { deleteExecution, getExecution } = require('@cumulus/api-client/executions');
const { deleteProvider } = require('@cumulus/api-client/providers');
const {
  api: apiTestUtils,
  addCollections,
  cleanupCollections,
  waitForCompletedExecution,
} = require('@cumulus/integration-tests');

const { buildAndExecuteWorkflow } = require('../helpers/workflowUtils');
const { waitForApiStatus } = require('../helpers/apiUtils');
const {
  loadConfig,
  createTimestampedTestId,
  createTestSuffix,
} = require('../helpers/testUtils');
const { buildHttpOrHttpsProvider, createProvider } = require('../helpers/Providers');
const { waitForGranuleAndDelete } = require('../helpers/granuleUtils');
const { constructCollectionId } = require('@cumulus/message/Collections');

const workflowName = 'DiscoverGranules';

describe('The Discover Granules workflow with http Protocol', () => {
  const collectionsDir = './data/collections/http_testcollection_001/';

  let beforeAllFailed = false;
  let collection;
  let config;
  let discoverGranulesExecution;
  let discoverGranulesExecutionArn;
  let discoverGranulesLambdaOutput;
  let ignoringFilesConfigExecutionArn;
  let ignoringFilesIngestExecutionArns;
  let ingestGranuleWorkflowArn1;
  let ingestGranuleWorkflowArn2;
  let ingestGranuleWorkflowArn3;
  let lambdaStep;
  let noFilesConfigExecutionArn;
  let noFilesIngestExecutionArns;
  let partialFilesConfigExecutionArn;
  let partialFilesIngestExecutionArns;
  let provider;
  let queueGranulesOutput;
  let testId;
  let testSuffix;

  beforeAll(async () => {
    try {
      config = await loadConfig();

      testId = createTimestampedTestId(config.stackName, 'DiscoverGranules');
      testSuffix = createTestSuffix(testId);
      collection = { name: `http_testcollection${testSuffix}`, version: '001' };
      provider = await buildHttpOrHttpsProvider(testSuffix);

      // populate collections and providers
      await Promise.all([
        addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
        createProvider(config.stackName, provider),
      ]);

      collection = JSON.parse((await apiTestUtils.getCollection({
        prefix: config.stackName,
        collectionName: collection.name,
        collectionVersion: collection.version,
      })).body);

      discoverGranulesExecution = await buildAndExecuteWorkflow(
        config.stackName,
        config.bucket,
        workflowName,
        collection,
        provider,
        undefined,
        { provider_path: 'granules/fake_granules' }
      );

      discoverGranulesExecutionArn = discoverGranulesExecution.executionArn;

      lambdaStep = new LambdaStep();

      queueGranulesOutput = await lambdaStep.getStepOutput(
        discoverGranulesExecutionArn,
        'QueueGranules'
      );
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  afterAll(async () => {
    await Promise.all(queueGranulesOutput.payload.running
      .map(async (arn) => {
        try {
          await waitForApiStatus(
            getExecution,
            {
              prefix: config.stackName,
              arn,
            },
            'completed'
          );
        } catch (error) {
          console.log(`Error waiting for execution ${arn}`);
          throw error;
        }
      }));

    await Promise.all(discoverGranulesLambdaOutput.payload.granules.map(
      async (granule) => {
        await waitForGranuleAndDelete(
          config.stackName,
          granule.granuleId,
          constructCollectionId(collection.name, collection.version),
          'completed'
        );
      }
    ));

    // Order matters. Child executions must be deleted before parents.
    await deleteExecution({ prefix: config.stackName, executionArn: ingestGranuleWorkflowArn1 });
    await deleteExecution({ prefix: config.stackName, executionArn: ingestGranuleWorkflowArn2 });
    await deleteExecution({ prefix: config.stackName, executionArn: ingestGranuleWorkflowArn3 });
    await deleteExecution({ prefix: config.stackName, executionArn: discoverGranulesExecutionArn });

    await Promise.all(noFilesIngestExecutionArns.map((executionArn) => deleteExecution({ prefix: config.stackName, executionArn })));
    await Promise.all(partialFilesIngestExecutionArns.map((executionArn) => deleteExecution({ prefix: config.stackName, executionArn })));
    await Promise.all(ignoringFilesIngestExecutionArns.map((executionArn) => deleteExecution({ prefix: config.stackName, executionArn })));

    await deleteExecution({ prefix: config.stackName, executionArn: ignoringFilesConfigExecutionArn });
    await deleteExecution({ prefix: config.stackName, executionArn: partialFilesConfigExecutionArn });
    await deleteExecution({ prefix: config.stackName, executionArn: noFilesConfigExecutionArn });

    await Promise.all([
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      deleteProvider({ prefix: config.stackName, providerId: provider.id }),
    ]);
  });

  it('executes successfully', () => {
    if (beforeAllFailed) fail('beforeAll() failed');

    expect(discoverGranulesExecution.status).toEqual('completed');
  });

  describe('the DiscoverGranules Lambda', () => {
    beforeAll(async () => {
      discoverGranulesLambdaOutput = await lambdaStep.getStepOutput(
        discoverGranulesExecutionArn,
        'DiscoverGranules'
      );
    });

    it('has expected granules output', () => {
      expect(discoverGranulesLambdaOutput.payload.granules.length).toEqual(3);
      expect(discoverGranulesLambdaOutput.payload.granules[0].granuleId).toEqual('granule-1');
      expect(discoverGranulesLambdaOutput.payload.granules[0].files.length).toEqual(2);
      expect(discoverGranulesLambdaOutput.payload.granules[0].files[0].type).toEqual('data');
    });
  });

  describe('the reporting lambda has received the CloudWatch step function event and', () => {
    it('the execution record is added to DynamoDB', async () => {
      const record = await waitForApiStatus(
        getExecution,
        {
          prefix: config.stackName,
          arn: discoverGranulesExecutionArn,
        },
        'completed'
      );
      expect(record.status).toEqual('completed');
    });
  });

  describe('QueueGranules lambda function', () => {
    it('has expected arns output', () => {
      expect(queueGranulesOutput.payload.running.length).toEqual(3);
    });
  });

  /**
   * The DiscoverGranules workflow queues granule ingest workflows, so check that one of the
   * granule ingest workflow completes successfully.
   */
  describe('IngestGranule workflow', () => {
    let ingestGranuleExecutionStatus;
    let syncGranuleLambdaOutput;

    beforeAll(() => {
      ingestGranuleWorkflowArn1 = queueGranulesOutput.payload.running[0];
      ingestGranuleWorkflowArn2 = queueGranulesOutput.payload.running[1];
      ingestGranuleWorkflowArn3 = queueGranulesOutput.payload.running[2];
    });

    it('executes successfully', async () => {
      console.log('\nwait for ingestGranuleWorkflow', ingestGranuleWorkflowArn1);
      ingestGranuleExecutionStatus = await waitForApiStatus(
        getExecution,
        { prefix: config.stackName, arn: ingestGranuleWorkflowArn1 },
        'completed'
      );
      expect(ingestGranuleExecutionStatus.status).toEqual('completed');
    });

    describe('SyncGranule lambda function', () => {
      it('outputs the expected granule', async () => {
        syncGranuleLambdaOutput = await lambdaStep.getStepOutput(
          ingestGranuleWorkflowArn1,
          'SyncGranule'
        );
        expect(syncGranuleLambdaOutput.payload.granules.length).toEqual(1);
      });
    });
  });

  describe('the DiscoverGranules Lambda with no files config', () => {
    let noFilesConfigExecution;
    let noFilesConfigQueueGranulesOutput;
    let noFilesConfigDiscoverGranulesOutput;

    beforeAll(async () => {
      await apiTestUtils.updateCollection({
        prefix: config.stackName,
        collection,
        updateParams: { files: [] },
      });

      noFilesConfigExecution = await buildAndExecuteWorkflow(
        config.stackName,
        config.bucket,
        workflowName,
        collection,
        provider,
        undefined,
        { provider_path: 'granules/fake_granules' }
      );

      noFilesConfigExecutionArn = noFilesConfigExecution.executionArn;

      noFilesConfigQueueGranulesOutput = await lambdaStep.getStepOutput(
        noFilesConfigExecutionArn,
        'QueueGranules'
      );

      noFilesIngestExecutionArns = noFilesConfigQueueGranulesOutput.payload.running;
    });

    afterAll(async () => {
      await Promise.all(
        noFilesConfigQueueGranulesOutput.payload.running
          .map((arn) => waitForCompletedExecution(arn))
      );
    });

    it('encounters a collection without a files configuration', async () => {
      const lambdaInput = await lambdaStep.getStepInput(
        noFilesConfigExecutionArn, 'DiscoverGranules'
      );

      expect(lambdaInput.meta.collection.files).toEqual([]);
    });

    it('executes successfully', () => {
      expect(noFilesConfigExecution.status).toEqual('completed');
    });

    it('discovers granules, but output has no files', async () => {
      noFilesConfigDiscoverGranulesOutput = await lambdaStep.getStepOutput(
        noFilesConfigExecutionArn, 'DiscoverGranules'
      );

      expect(noFilesConfigDiscoverGranulesOutput.payload.granules.length).toEqual(3);
      noFilesConfigDiscoverGranulesOutput.payload.granules.forEach((granule, i) => {
        expect(granule.granuleId).toEqual(`granule-${i + 1}`);
        expect(granule.files.length).toEqual(0);
      });
    });
  });

  describe('the DiscoverGranules Lambda with partial files config', () => {
    let discoverGranulesPartialFilesConfigLambdaOutput;
    let partialFilesConfigExecution;
    let partialFilesQueueGranulesOutput;

    beforeAll(async () => {
      await apiTestUtils.updateCollection({
        prefix: config.stackName,
        collection,
        updateParams: { files: [collection.files[0]] },
      });

      partialFilesConfigExecution = await buildAndExecuteWorkflow(
        config.stackName,
        config.bucket,
        workflowName,
        collection,
        provider,
        undefined,
        { provider_path: 'granules/fake_granules' }
      );

      partialFilesConfigExecutionArn = partialFilesConfigExecution.executionArn;

      partialFilesQueueGranulesOutput = await lambdaStep.getStepOutput(
        partialFilesConfigExecutionArn,
        'QueueGranules'
      );

      partialFilesIngestExecutionArns = partialFilesQueueGranulesOutput.payload.running;
    });

    afterAll(async () => {
      await Promise.all(
        partialFilesQueueGranulesOutput.payload.running
          .map((arn) => waitForCompletedExecution(arn))
      );
    });

    it('encounters a collection with a files configuration that does not match all files', async () => {
      const lambdaInput = await lambdaStep.getStepInput(
        partialFilesConfigExecutionArn, 'DiscoverGranules'
      );

      expect(lambdaInput.meta.collection.files).toEqual([collection.files[0]]);
    });

    it('executes successfully', () => {
      expect(partialFilesConfigExecution.status).toEqual('completed');
    });

    it('discovers granules, but output does not include all files', async () => {
      discoverGranulesPartialFilesConfigLambdaOutput = await lambdaStep.getStepOutput(
        partialFilesConfigExecutionArn, 'DiscoverGranules'
      );

      expect(discoverGranulesPartialFilesConfigLambdaOutput.payload.granules.length).toEqual(3);
      discoverGranulesPartialFilesConfigLambdaOutput.payload.granules.forEach((granule, i) => {
        expect(granule.granuleId).toEqual(`granule-${i + 1}`);
        expect(granule.files.length).toEqual(1);
      });
    });
  });

  describe('the DiscoverGranules Lambda ignoring files config', () => {
    let discoverGranulesIgnoringFilesConfigLambdaOutput;
    let ignoringFilesConfigExecution;
    let ignoringFilesQueueGranulesOutput;

    beforeAll(async () => {
      await apiTestUtils.updateCollection({
        prefix: config.stackName,
        collection,
        updateParams: {
          files: [],
          ignoreFilesConfigForDiscovery: true,
        },
      });

      ignoringFilesConfigExecution = await buildAndExecuteWorkflow(
        config.stackName,
        config.bucket,
        workflowName,
        collection,
        provider,
        undefined,
        { provider_path: 'granules/fake_granules' }
      );

      ignoringFilesConfigExecutionArn = ignoringFilesConfigExecution.executionArn;

      ignoringFilesQueueGranulesOutput = await lambdaStep.getStepOutput(
        ignoringFilesConfigExecutionArn,
        'QueueGranules'
      );

      ignoringFilesIngestExecutionArns = ignoringFilesQueueGranulesOutput.payload.running;
    });

    afterAll(async () => {
      await Promise.all(
        ignoringFilesIngestExecutionArns.map((arn) => waitForCompletedExecution(arn))
      );
    });

    it('encounters a collection that has no files config, but should ignore files config', async () => {
      const lambdaInput = await lambdaStep.getStepInput(
        ignoringFilesConfigExecutionArn, 'DiscoverGranules'
      );

      expect(lambdaInput.meta.collection.files).toEqual([]);
    });

    it('executes successfully', () => {
      expect(ignoringFilesConfigExecution.status).toEqual('completed');
    });

    it('discovers granules, but output includes all files', async () => {
      discoverGranulesIgnoringFilesConfigLambdaOutput = await lambdaStep.getStepOutput(
        ignoringFilesConfigExecutionArn, 'DiscoverGranules'
      );

      expect(discoverGranulesIgnoringFilesConfigLambdaOutput.payload.granules.length).toEqual(3);
      discoverGranulesIgnoringFilesConfigLambdaOutput.payload.granules.forEach((granule, i) => {
        expect(granule.granuleId).toEqual(`granule-${i + 1}`);
        expect(granule.files.length).toEqual(2);
      });
    });
  });
});

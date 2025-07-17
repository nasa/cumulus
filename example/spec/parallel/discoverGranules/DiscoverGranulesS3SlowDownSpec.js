'use strict';

const pWaitFor = require('p-wait-for');
const {
  getExecutionInputObject,
  loadCollection,
  loadProvider,
  waitForCompletedExecution,
} = require('@cumulus/integration-tests');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const {
  createCollection, deleteCollection,
} = require('@cumulus/api-client/collections');
const { getExecution, deleteExecution } = require('@cumulus/api-client/executions');
const {
  createProvider, deleteProvider,
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

describe('The DiscoverGranules workflow', () => {
  let beforeAllError;
  let bucket;
  let collection;
  let expectedGranuleId;
  let ingestGranuleExecutionArn;
  let provider;
  let providerPath;
  let discoverGranulesOutput;
  let queueGranulesOutput;
  let stackName;
  let workflowExecution;
  let granuleCount;
  let concurrency;
  var originalTimeout;
  let existingTestId;
  let multipleFileSets;

  beforeAll(async () => {
    try {
      originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
      jasmine.DEFAULT_TIMEOUT_INTERVAL = 4 * 60 * 60 * 100; //4 hours

      //optional
      //existingTestId = 'teclark-DiscoverGranuleS3Success-1749056370921';

      ({ stackName, bucket } = await loadConfig());

      process.env.stackName = stackName;
      process.env.system_bucket = bucket;
      console.log('');
      console.log('process.env.system_bucket', process.env.system_bucket);

      const testId = createTimestampedTestId(stackName, 'DiscoverGranuleS3Success');
      //const testId = 'prefix1';
      console.log('testId', testId);

      // Create the provider
      provider = await loadProvider({
        filename: './data/providers/s3/s3_provider.json',
        postfix: testId,
        s3Host: bucket,
      });
      provider.globalConnectionLimit = 1000;

      //override prefix
      var customPrefix = "file-staging/ATL08/006/";
      //await createProvider({ prefix: customPrefix, provider });
      await createProvider({ prefix: stackName, provider });

      // Create the collection
      collection = await loadCollection({
        filename: './data/collections/s3_ATL08_006/s3_ATL08_006.json',
        //filename: './data/collections/s3_MOD09GQ_006/s3_MOD09GQ_006.json',
        postfix: testId,
      });

      //await createCollection({ prefix: customPrefix, collection });
      await createCollection({ prefix: stackName, collection });

      if (existingTestId) {
        providerPath = `cumulus-test-data/${existingTestId}`;
        console.log('existing providerPath', providerPath);

      } else {
        var providerPath = "file-staging/ATL08/006";
        //providerPath = `cumulus-test-data/${testId}`;
        //providerPath = `${testId}`;
        console.log('new providerPath', providerPath);

        // // Upload the granule to be discovered
        // concurrency = 50;
        // granuleCount = 100;
        // multipleFileSets = 2;
        // var promises = [];
        // for(var i = 1; i <= granuleCount; i++) {
        //   console.log('i', i);

        //   promises.push(uploadS3GranuleDataForDiscovery({
        //     bucket,
        //     prefix: providerPath,
        //     multipleFileSets: multipleFileSets
        //   }));

        //   if (promises.length == concurrency || i == granuleCount) {
        //     try {
        //       console.log("Waiting for async functions...");
        //       const results = await Promise.all(promises);
        //       console.log("All async functions completed.");
        //       console.log("Results:", results);
        //     } catch (error) {
        //       console.error("An error occurred:", error);
        //     } finally {
        //       //reset array
        //       promises = [];
        //     }
        //   }

        //   // const { granuleId } = await uploadS3GranuleDataForDiscovery({
        //   //   bucket,
        //   //   prefix: providerPath,
        //   // });
        //   //expectedGranuleId = granuleId;
        //   //console.log('expectedGranuleId, i=' + i, expectedGranuleId);
        // }
      }

      // Execute the DiscoverGranules workflow
      workflowExecution = await buildAndExecuteWorkflow(
        stackName,
        bucket,
        'DiscoverGranulesToThrottledQueue',
        collection,
        provider,
        undefined,
        { provider_path: providerPath }
      );
      console.log('workflowExecution', workflowExecution);

      const lambdaStep = new LambdaStep();

      discoverGranulesOutput = await lambdaStep.getStepOutput(
        workflowExecution.executionArn,
        'DiscoverGranulesToThrottledQueue'
      );

      console.log('!!! discoverGranulesOutput', discoverGranulesOutput);

      // Get the output of the QueueGranules task. Doing it here because there are
      // two tests that need it.
      queueGranulesOutput = await lambdaStep.getStepOutput(
        workflowExecution.executionArn,
        'QueueGranules'
      );

      console.log('!!! queueGranulesOutput', queueGranulesOutput);

    } catch (error) {
      beforeAllError = error;
    }
  });

  afterAll(async () => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;

    //TEMP
    return;

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

  it('executes successfully', () => {
    if (beforeAllError) fail(beforeAllError);
    else expect(workflowExecution.status).toEqual('completed');
  });

  it('can be fetched from the API', async () => {
    if (beforeAllError) fail(beforeAllError);
    else {
      await expectAsync(
        pWaitFor(
          async () => {
            const { status } = await getExecution({
              prefix: stackName,
              arn: workflowExecution.executionArn,
            });

            return status === 'completed';
          },
          { interval: 2000, timeout: 60000 }
        )
      ).toBeResolved();
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

  // describe('DiscoverGranules task', () => {
  //   it('outputs the list of discovered granules', () => {
  //     if (beforeAllError) fail(beforeAllError);
  //     else {
  //       expect(discoverGranulesOutput.payload.granules.length).toEqual(granuleCount);
  //       const granule = discoverGranulesOutput.payload.granules[discoverGranulesOutput.payload.granules.length - 1]; //last item
  //       expect(granule.granuleId).toEqual(expectedGranuleId);
  //       expect(granule.dataType).toEqual(collection.name);
  //       expect(granule.version).toEqual(collection.version);
  //       expect(granule.files.length).toEqual(3);
  //     }
  //   });
  // });

  describe('QueueGranules task', () => {
    afterAll(async () => {
      await Promise.all(
        queueGranulesOutput.payload.running
          .map((arn) => waitForCompletedExecution(arn))
      );
    });

    it('has queued the granule', () => {
      if (beforeAllError) fail(beforeAllError);
      else expect(queueGranulesOutput.payload.running.length).toEqual(granuleCount);
    });

    it('passes through childWorkflowMeta to the IngestGranule execution', async () => {
      if (beforeAllError) fail(beforeAllError);
      ingestGranuleExecutionArn = queueGranulesOutput.payload.running[0];
      const executionInput = await getExecutionInputObject(queueGranulesOutput.payload.running[0]);
      expect(executionInput.meta.staticValue).toEqual('aStaticValue');
      expect(executionInput.meta.interpolatedValueStackName).toEqual(queueGranulesOutput.meta.stack);
    });
  });
});

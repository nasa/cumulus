const fs = require('fs');
const {
  addCollections,
  addProviders,
  cleanupCollections,
  cleanupProviders,
} = require('@cumulus/integration-tests');
const { updateCollection } = require('@cumulus/integration-tests/api/api');
const { deleteExecution } = require('@cumulus/api-client/executions');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { getGranule } = require('@cumulus/api-client/granules');

const {
  waitForApiStatus,
} = require('../helpers/apiUtils');

const { buildAndExecuteWorkflow } = require('../helpers/workflowUtils');
const {
  loadConfig,
  uploadTestDataToBucket,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
  deleteFolder,
} = require('../helpers/testUtils');
const {
  setupLoadTestGranuleForIngest,
  cleanupLoadTestGranules,
} = require('../helpers/granuleUtils');
const workflowName = 'QueueGranules';
const providersDir = './data/providers/s3/';
const collectionsDir = './data/collections/s3_MOD09GQ_006';

// ** Configurable Variables

const granuleCountPerWorkflow = 425; // 425 granules per workflow is the max allowable by the API
const totalWorkflowCount = 500; // number of workflows to fire off

describe('Ingest Load Test ', () => {
  let beforeAllFailed = false;
  const testGranulesPerInputPayloads = [];
  const testQueueGranulesExecutionArns = [];
  const testQueueGranulesNestedExecutionArns = [];
  const testSuffixes = [];

  const inputPayloadFilename = './spec/loadTest/ingestLoadTest.input.payload.json';

  const s3data = [
    '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
    '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  ];
  const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
  const queueUrl = 'https://sqs.us-east-1.amazonaws.com/596205514787/vkn-tf-startSF';

  let config;

  beforeAll(async () => {
    if (!Number.isFinite(Number(granuleCountPerWorkflow)) || granuleCountPerWorkflow > 425) {
      beforeAllFailed = `===== Spec beforeAll() - Invalid input for number of granules per Workflow detected - ${granuleCountPerWorkflow} =====`;
      throw new Error(beforeAllFailed);
    }

    try {
      config = await loadConfig();

      process.env.GranulesTable = `${config.stackName}-GranulesTable`;
      process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
      process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
    } catch (error) {
      beforeAllFailed = `===== Spec beforeAll() failed =====\n ${error}`;
      throw new Error(beforeAllFailed);
    }
  });

  afterAll(async () => {
    // clean up stack state added by test

    await Promise.all(
      testGranulesPerInputPayloads.map(async (inPayload) =>
        await cleanupLoadTestGranules(config.stackName, inPayload.granules))
    );

    console.log('\n===== Delete lambdaOutputPayload ExecutionArns =====');
    await Promise.all(
      testQueueGranulesNestedExecutionArns.map(async (lambdaOutputPayload) => {
        console.log(`${JSON.stringify(lambdaOutputPayload)}`);
        await lambdaOutputPayload.running.map(async (childExecutionArn) =>
          await deleteExecution({
            prefix: config.stackName,
            executionArn: childExecutionArn,
          }));
      })
    );
    console.log('\n===== Delete queueGranules ExecutionArns =====');
    await Promise.all(
      testQueueGranulesExecutionArns.map(async (qGranulesExecutionArn) => {
        console.log(`${JSON.stringify(qGranulesExecutionArn)}`);
        await deleteExecution({
          prefix: config.stackName,
          executionArn: qGranulesExecutionArn,
        });
      })
    );

    await Promise.all(
      testSuffixes.map(async (testSuffix) => {
        await cleanupCollections(
          config.stackName,
          config.bucket,
          collectionsDir,
          testSuffix
        );
        cleanupProviders(
          config.stackName,
          config.bucket,
          providersDir,
          testSuffix
        );
      })
    );
  });

  it('prepares the test suite successfully', () => {
    if (beforeAllFailed) fail(beforeAllFailed);
  });

  function batchQueueGranuleWorkflowVerification() {
    let workflowExecution;

    describe(`The QueueGranules workflow in the total of ${totalWorkflowCount} workflows`, () => {
      let lambdaStep;
      let testSuffix;
      let testDataFolder;
      let collection;
      let provider;
      let inputPayload;

      beforeAll(async () => {
        try {
          lambdaStep = new LambdaStep();

          const testId = createTimestampedTestId(config.stackName, 'GranuleIngestLoadTest');
          testSuffix = createTestSuffix(testId);
          testDataFolder = `custom-staging-dir/${createTestDataPath(testId)}`;

          collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
          provider = { id: `s3_provider${testSuffix}` };

          // populate collections, providers and test data
          await Promise.all([
            uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
            addCollections(
              config.stackName,
              config.bucket,
              collectionsDir,
              testSuffix
            ),
            addProviders(
              config.stackName,
              config.bucket,
              providersDir,
              config.bucket,
              testSuffix
            ),
          ]);
          await updateCollection({
            prefix: config.stackName,
            collection,
            updateParams: { duplicateHandling: 'replace' },
          });

          const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
          // update test data filepaths
          inputPayload = await setupLoadTestGranuleForIngest(
            config.bucket,
            inputPayloadJson,
            granuleCountPerWorkflow,
            granuleRegex,
            testSuffix,
            testDataFolder
          );
          testSuffixes.push(testSuffix);

          const inputMeta = {
            queueUrl,
          };

          workflowExecution = await buildAndExecuteWorkflow(
            config.stackName,
            config.bucket,
            workflowName,
            collection,
            provider,
            inputPayload,
            inputMeta
          );

          testQueueGranulesExecutionArns.push(workflowExecution.executionArn);
          testGranulesPerInputPayloads.push(inputPayload);
        } catch (error) {
          beforeAllFailed = `===== Block beforeAll() failed =====\n ${error}`;
          throw new Error(beforeAllFailed);
        }
      });

      afterAll(async () => {
        // console.log(`\n===== Delete S3TestDataFolder: ${testDataFolder} =====`);
        await deleteFolder(config.bucket, testDataFolder);
      });

      it('completes execution with success status', () => {
        // console.log(`==== workflowExecution =====\n ${JSON.stringify(workflowExecution)}\n`);
        expect(workflowExecution.status).toEqual('completed');
      });

      describe('the QueueGranules Lambda function', () => {
        it('sets granule status to complete', async () => {
          const expectedValues = ['completed', 'running'];
          await Promise.all(
            inputPayload.granules.map(async (granule) => {
              const record = await waitForApiStatus(
                getGranule,
                {
                  prefix: config.stackName,
                  granuleId: granule.granuleId,
                },
                expectedValues
              );
              expect(expectedValues).toContain(record.status);
            })
          );
        });

        it('has expected arns output', async () => {
          const lambdaOutput = await lambdaStep.getStepOutput(
            workflowExecution.executionArn,
            'QueueGranules'
          );
          testQueueGranulesNestedExecutionArns.push(lambdaOutput.payload);
          // console.log(`==== lambdaOutput =====\n ${JSON.stringify(lambdaOutput.payload)}`);
          expect(lambdaOutput.payload.running.length).toEqual(granuleCountPerWorkflow);
        });
      });
    });
  }

  const processWorkflows = async () => {
    const workflowsTriggerPromises = new Array(totalWorkflowCount).fill().map(
      async () => {
        batchQueueGranuleWorkflowVerification();
      }
    );
    await Promise.all(workflowsTriggerPromises);
  };

  try {
    processWorkflows();
  } catch (error) {
    console.log(error);
    throw error;
  }
});

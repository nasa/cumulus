const fs = require('fs');
const pMap = require('p-map');
const {
  addCollections,
  addProviders,
  cleanupCollections,
  cleanupProviders,
} = require('@cumulus/integration-tests');
const { updateCollection } = require('@cumulus/integration-tests/api/api');
const { deleteExecution } = require('@cumulus/api-client/executions');

const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { sqs } = require('@cumulus/aws-client/services');
const { getGranule } = require('@cumulus/api-client/granules');
const { randomString } = require('@cumulus/common/test-utils');
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
  greenConsoleLog,
  redConsoleLog,
  yellowConsoleLog,
  blueConsoleLog,
} = require('../helpers/testUtils');

const {
  cleanupLoadTestGranules,
  setupGranulesForIngestLoadTest,
} = require('../helpers/granuleUtils');

const workflowName = 'QueueGranules';
const inputPayloadFilename = './spec/loadTest/ingestLoadTest.input.payload.json';
const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');

const providersDir = './data/providers/s3/';
const collectionsDir = './data/collections/s3_MOD09GQ_006';
const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
];
const queueUrl = 'https://sqs.us-east-1.amazonaws.com/596205514787/vkn-tf-startSF';

// ** Configurable Variables

const granuleCountPerWorkflow = 40; // 450 granules per workflow is the max allowable by the API
const totalWorkflowCount = 12; // number of workflows to fire off

const granuleCountThreshold = 0.95;

const totalInputPayloads = [];
const queueGranulesExecutionArns = [];
const queueGranulesChildExecutionArns = [];
const testSuffixes = [];
const totalGranulesCompleted = [];

let config;
let workflowExecution;
let inputPayload;
let beforeAllFailed = false;
let colorConsoleLog = redConsoleLog();

const batchGranulesProcessing = async (nthWorkflow) => {
  console.log(yellowConsoleLog(), `\n___ Executing ${nthWorkflow}/${totalWorkflowCount} ${workflowName} workflows ___`);

  const testId = createTimestampedTestId(config.stackName, 'GranuleIngestLoadTest');
  const testSuffix = `${createTestSuffix(testId)}_${randomString()}`;
  const testDataFolder = `custom-staging-dir/${createTestDataPath(testId)}`;
  const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
  const provider = { id: `s3_provider${testSuffix}` };

  try {
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

    inputPayload = await setupGranulesForIngestLoadTest(
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

    queueGranulesExecutionArns.push(workflowExecution.executionArn);
    totalInputPayloads.push(inputPayload);

    if (workflowExecution.status === 'completed') {
      console.log(greenConsoleLog(), `\n___ Execution of Workflow ${nthWorkflow} completed with success status ___`);
    } else {
      console.log(redConsoleLog(), `\n___ Execution of Workflow ${nthWorkflow} Failed ___\n ${JSON.stringify(workflowExecution)}\n`);
    }

    const lambdaOutput = await new LambdaStep().getStepOutput(
      workflowExecution.executionArn,
      'QueueGranules'
    );
    queueGranulesChildExecutionArns.push(lambdaOutput.payload);

    if (lambdaOutput.payload.running.length === granuleCountPerWorkflow) {
      colorConsoleLog = greenConsoleLog();
    } else {
      colorConsoleLog = redConsoleLog();
      console.log(colorConsoleLog, '\n___ lambdaOutputPayload ExecutionArns ___');
      lambdaOutput.payload.running.map((runningArn) =>
        console.log(`${JSON.stringify(runningArn)}`));
    }
    console.log(colorConsoleLog,
      `\n___ Lambda Output of Workflow ${nthWorkflow} has ${lambdaOutput.payload.running.length}/${granuleCountPerWorkflow} of expected arns ___`);

    const completedGranules = [];
    const expectedValues = ['completed'];

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
        completedGranules.push(record);
        totalGranulesCompleted.push(record);
      })
    );

    console.log(greenConsoleLog(),
      `\n___ ${completedGranules.length}/${inputPayload.granules.length} Granules ingested by workflow ${nthWorkflow} are set to completed status ___`);
  } catch (error) {
    beforeAllFailed = `===== beforeAll() failed =====\n ${error}`;
    throw new Error(beforeAllFailed);
  } finally {
    console.log(blueConsoleLog(), `\n===== Delete S3TestDataFolder: ${testDataFolder} =====`);
    await deleteFolder(config.bucket, testDataFolder);
  }
};

describe('The Granule Ingest Load Test ', () => {
  beforeAll(async () => {
    if (!Number.isFinite(Number(granuleCountPerWorkflow)) || granuleCountPerWorkflow > 425) {
      beforeAllFailed = `===== beforeAll() - Invalid input for number of granules per Workflow detected - ${granuleCountPerWorkflow} =====`;
      throw new Error(beforeAllFailed);
    } else {
      try {
        config = await loadConfig();

        process.env.GranulesTable = `${config.stackName}-GranulesTable`;
        process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
        process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;

        await pMap(
          new Array(totalWorkflowCount).fill().map((_, index) => index + 1),
          async (index) => {
            await batchGranulesProcessing(index);
          },
          { concurrency: 8 }
        );
      } catch (error) {
        beforeAllFailed = `===== beforeAll() failed =====\n ${error}`;
        throw new Error(beforeAllFailed);
      }
    }
  });

  afterAll(async () => {
    // clean up stack state added by test

    await Promise.all(
      totalInputPayloads.map(async (inPayload) =>
        await cleanupLoadTestGranules(config.stackName, inPayload.granules))
    );

    console.log(blueConsoleLog(), '\n===== Delete lambdaOutputPayload ExecutionArns =====');
    await Promise.all(
      queueGranulesChildExecutionArns.map(async (lambdaOutputPayload) => {
        console.log(blueConsoleLog(), `${JSON.stringify(lambdaOutputPayload)}`);
        await lambdaOutputPayload.running.map(async (childExecutionArn) =>
          await deleteExecution({
            prefix: config.stackName,
            executionArn: childExecutionArn,
          }));
      })
    );
    console.log(blueConsoleLog(), '\n===== Delete queueGranules ExecutionArns =====');
    await Promise.all(
      queueGranulesExecutionArns.map(async (qGranulesExecutionArn) => {
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

  it('writes to database the expected number of granules with status completed', () => {
    const expectedGranuleCount = granuleCountPerWorkflow * totalWorkflowCount;
    expect(expectedGranuleCount * granuleCountThreshold < totalGranulesCompleted.length && totalGranulesCompleted.length <= expectedGranuleCount).toBeTruthy();
    console.log(colorConsoleLog, `\n*** The total ingested Granules = ${totalGranulesCompleted.length}/${expectedGranuleCount} ***`);
  });
});

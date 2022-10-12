/* eslint-disable no-await-in-loop */
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
const { getGranule } = require('@cumulus/api-client/granules');

const { randomString } = require('@cumulus/common/test-utils');
const {
  waitForApiStatus,
} = require('../helpers/apiUtils');

const { buildAndExecuteWorkflow } = require('../helpers/workflowUtils');
const {
  loadConfig,
  createTimestampedTestId,
  createTestSuffix,
  greenConsoleLog,
  redConsoleLog,
  yellowConsoleLog,
  blueConsoleLog,
} = require('../helpers/testUtils');

const {
  cleanupLoadTestGranules,
  setupGranulesForIngestLoadTest,
} = require('../helpers/granuleUtils');

jasmine.DEFAULT_TIMEOUT_INTERVAL = 70 * 60 * 1000;

const workflowName = 'QueueGranulesPassthrough';
const inputPayloadFilename = './spec/loadTest/ingestLoadTestPassthrough.input.payload.json';
const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');

const providersDir = './data/providers/s3/';
const collectionsDir = './data/collections/s3_MOD09GQ_006';
const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

// ** Configurable Variables

const granuleThresholdPerWorkflow = 100;
const granuleCountPerWorkflow = 100; // 100 granules per workflow is the max allowable by the API
const totalWorkflowCount = 100; // number of workflows to fire off

const totalInputPayloads = [];
const queueGranulesExecutionArns = [];
const queueGranulesChildExecutionArns = [];
const totalGranulesCompleted = [];

let config;
let beforeAllFailed = false;
let colorConsoleLog = redConsoleLog();
let testSuffix;

const batchGranulesProcessing = async (nthWorkflow, collection, provider) => {
  console.log(yellowConsoleLog(), `\n___ Executing ${nthWorkflow}/${totalWorkflowCount} ${workflowName} workflows ___`);

  const inputPayload = await setupGranulesForIngestLoadTest(
    config.bucket,
    inputPayloadJson,
    granuleCountPerWorkflow,
    granuleRegex,
    testSuffix
  );

  const workflowExecution = await buildAndExecuteWorkflow(
    config.stackName,
    config.bucket,
    workflowName,
    collection,
    provider,
    inputPayload
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
  const incompletedGranules = [];

  const expectedValues = ['completed'];

  await Promise.all(
    inputPayload.granules.map(async (granule) => {
      try {
        const record = await waitForApiStatus(
          getGranule,
          {
            prefix: config.stackName,
            granuleId: granule.granuleId,
          },
          expectedValues,
          { interval: 10 * 1000, timeout: 15 * 60 * 1000 }
        );
        completedGranules.push(record);
        totalGranulesCompleted.push(record);
      } catch (error) {
        incompletedGranules.push({ granuleId: granule.granuleId, err: error });
      }
    })
  );

  console.log(greenConsoleLog(),
    `\n___ ${completedGranules.length}/${inputPayload.granules.length} Granules completed by workflow ${nthWorkflow} ___`);

  if (completedGranules.length !== inputPayload.granules.length) {
    console.log(redConsoleLog(),
      `\n___ ${incompletedGranules.length}/${inputPayload.granules.length} Granules incompleted by workflow ${nthWorkflow} ___`);

    incompletedGranules.map((granuleError) =>
      console.log(redConsoleLog(),
        `\n${JSON.stringify(granuleError.granuleId)} - ${granuleError.err}`));
  }
};

describe('The Granule Ingest Load Test ', () => {
  beforeAll(async () => {
    if (!Number.isFinite(Number(granuleCountPerWorkflow)) || granuleCountPerWorkflow > granuleThresholdPerWorkflow) {
      beforeAllFailed = `===== beforeAll() - Invalid input for number of granules per Workflow detected - ${granuleCountPerWorkflow} =====`;
      throw new Error(beforeAllFailed);
    } else {
      try {
        config = await loadConfig();

        process.env.GranulesTable = `${config.stackName}-GranulesTable`;
        process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
        process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;

        const testId = createTimestampedTestId(config.stackName, 'GranuleIngestLoadTest');
        testSuffix = `${createTestSuffix(testId)}_${randomString()}`;

        const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
        const provider = { id: `s3_provider${testSuffix}` };

        // populate collections, providers and test data
        await Promise.all([
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

        await pMap(
          new Array(totalWorkflowCount).fill().map((_, index) => index + 1),
          async (index) => {
            await batchGranulesProcessing(index, collection, provider);
          },
          { concurrency: 5 }
        );
        /* let workflowCount = 1;
        while (workflowCount <= totalWorkflowCount) {
          await batchGranulesProcessing(workflowCount, collection, provider);
          workflowCount += 1;
        } */
      } catch (error) {
        beforeAllFailed = `===== beforeAll() failed =====\n ${error}`;
        throw new Error(beforeAllFailed);
      }
    }
  });

  /* afterAll(async () => {
    // clean up stack state added by test
    await Promise.all(
      totalInputPayloads.map(async (inPayload) =>
        await cleanupLoadTestGranules(config.stackName, inPayload.granules))
    );

    console.log(blueConsoleLog(), '\n===== Delete lambdaOutputPayload ExecutionArns =====');
    queueGranulesChildExecutionArns.forEach((lambdaOutputPayload) => {
      lambdaOutputPayload.running.forEach((childExecutionArn) => {
        deleteExecution({
          prefix: config.stackName,
          executionArn: childExecutionArn,
        });
      });
    });

    if (queueGranulesExecutionArns !== undefined) {
      console.log(blueConsoleLog(), '\n===== Delete queueGranules ExecutionArns =====');
      queueGranulesExecutionArns.forEach((qGranulesExecutionArn) => {
        deleteExecution({
          prefix: config.stackName,
          executionArn: qGranulesExecutionArn,
        });
        console.log(blueConsoleLog(), `${JSON.stringify(qGranulesExecutionArn)}`);
      });
    }

    await Promise.all([
      await cleanupCollections(
        config.stackName,
        config.bucket,
        collectionsDir,
        testSuffix
      ),
      cleanupProviders(
        config.stackName,
        config.bucket,
        providersDir,
        testSuffix
      ),
    ]);
  }); */

  it('writes to database the expected number of granules with status completed', () => {
    const expectedGranuleCount = granuleCountPerWorkflow * totalWorkflowCount;
    expect(expectedGranuleCount).toEqual(totalGranulesCompleted.length);
    console.log(colorConsoleLog, `\n*** The total ingested Granules = ${totalGranulesCompleted.length}/${expectedGranuleCount} ***`);
  });
});

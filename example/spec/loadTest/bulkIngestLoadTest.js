const fs = require('fs');
const {
  addCollections,
  addProviders,
  cleanupCollections,
  cleanupProviders,
} = require('@cumulus/integration-tests');
const { updateCollection } = require('@cumulus/integration-tests/api/api');
const { getExecution, deleteExecution } = require('@cumulus/api-client/executions');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { sqs } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');
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
  setupBulkTestGranuleForIngest,
  cleanupBulkTestGranules,
} = require('../helpers/granuleUtils');
const workflowName = 'QueueGranules';
const providersDir = './data/providers/s3/';
const collectionsDir = './data/collections/s3_MOD09GQ_006';

// ** Configurable Variables

const granuleCountPerWorkflow = 200;
const totalWorkflowCount = 2; // number of workflows to fire off

describe('Bulk Ingest Load Test ', () => {
  const testQueueUrls = [];
  const testGranulesPerInputPayloads = [];
  const testQueueGranulesExecutionArns = [];
  const testDataFolders = [];

  const inputPayloadFilename = './spec/loadTest/BulkGranuleIngest.input.payload.json';

  const s3data = [
    '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
    '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  ];
  const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

  let config;
  let workflowCount = 0;

  beforeAll(async () => {
    config = await loadConfig();

    process.env.GranulesTable = `${config.stackName}-GranulesTable`;
    process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
    process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
  });

  afterAll(async () => {
    // clean up stack state added by test
    console.log('\n===== Delete QueueUrls =====');
    const deleteQueueUrlsPromises = testQueueUrls.map(
      async (qUrl) => {
        console.log(`${JSON.stringify(qUrl)}`);
        await sqs().deleteQueue({
          QuereUrl: qUrl,
        });
      }
    );
    await Promise.all(deleteQueueUrlsPromises);

    const deleteGranulesPerInputPayloadPromises = testGranulesPerInputPayloads.map(
      async (inPayload) => {
        console.log('\n===== Delete granules per inputPayload =====');
        //inPayload.granules.map((g) => console.log(`${JSON.stringify(g.granuleId)}`));
        await cleanupBulkTestGranules(config.stackName, inPayload.granules);
      }
    );
    await Promise.all(deleteGranulesPerInputPayloadPromises);

    console.log('\n===== Delete queueGranulesExecutionArns =====');
    const deleteQueueGranulesExecutionArnsPromises = testQueueGranulesExecutionArns.map(
      async (qGranulesExecutionArn) => {
        console.log(`${JSON.stringify(qGranulesExecutionArn)}`);
        await deleteExecution({
          prefix: config.stackName,
          executionArn: qGranulesExecutionArn,
        });
      }
    );
    await Promise.all(deleteQueueGranulesExecutionArnsPromises);

    console.log('\n===== Delete testDataFolders =====');
    const deleteTestDataFoldersPromises = testDataFolders.map(
      async ({ testDataFolder, testSuffix }) => {
        console.log(`${JSON.stringify(testDataFolder)}`);
        await deleteFolder(config.bucket, testDataFolder);
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
      }
    );
    await Promise.all(deleteTestDataFoldersPromises);
  });

  function batchQueueGranuleWorkflowVerification() {
    let workflowExecution;

    describe(`The QueueGranules workflow ${workflowCount + 1} out of ${totalWorkflowCount} `, () => {
      let lambdaStep;
      let testSuffix;
      let testDataFolder;
      let collection;
      let provider;
      let queueGranulesExecutionArn;
      let queueUrl;
      let inputPayload;

      beforeAll(async () => {
        lambdaStep = new LambdaStep();

        const testId = createTimestampedTestId(config.stackName, 'BulkGranuleIngest');
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

        const QueueName = randomString();
        const { QueueUrl } = await sqs().createQueue({ QueueName }).promise();
        queueUrl = QueueUrl;

        const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
        // update test data filepaths
        inputPayload = await setupBulkTestGranuleForIngest(
          config.bucket,
          inputPayloadJson,
          granuleCountPerWorkflow,
          granuleRegex,
          testSuffix,
          testDataFolder
        );

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

        queueGranulesExecutionArn = workflowExecution.executionArn;

        testQueueGranulesExecutionArns.push(queueGranulesExecutionArn);
        testQueueUrls.push(queueUrl);
        testGranulesPerInputPayloads.push(inputPayload);
        testDataFolders.push({ testDataFolder: testDataFolder, testSuffix: testSuffix });
      });

      it('completes execution with success status', () => {
        expect(workflowExecution.status).toEqual('completed');
      });

      describe('the QueueGranules Lambda function', () => {
        it('sets granule status to queued', async () => {
          await Promise.all(
            inputPayload.granules.map(async (granule) => {
              const record = await waitForApiStatus(
                getGranule,
                {
                  prefix: config.stackName,
                  granuleId: granule.granuleId,
                },
                'queued'
              );
              expect(record.status).toEqual('queued');
            })
          );
        });

        it('has expected arns output', async () => {
          const lambdaOutput = await lambdaStep.getStepOutput(
            workflowExecution.executionArn,
            'QueueGranules'
          );
          //console.log(`==== lambdaOutput =====\n ${JSON.stringify(lambdaOutput.payload)}`);
          expect(lambdaOutput.payload.running.length).toEqual(granuleCountPerWorkflow);
        });
      });
    });
  }
  while (workflowCount < totalWorkflowCount) {
    batchQueueGranuleWorkflowVerification();
    workflowCount += 1;
  }
});

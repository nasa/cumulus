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

const { constructCollectionId } = require('@cumulus/message/Collections');
const {
  waitForApiStatus,
} = require('../../helpers/apiUtils');

const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const {
  loadConfig,
  uploadTestDataToBucket,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
  deleteFolder,
} = require('../../helpers/testUtils');
const {
  setupTestGranuleForIngest,
  waitForGranuleAndDelete,
} = require('../../helpers/granuleUtils');
const workflowName = 'QueueGranules';
const providersDir = './data/providers/s3/';
const collectionsDir = './data/collections/s3_MOD09GQ_006';

describe('The Queue Granules workflow', () => {
  let collection;
  let config;
  let inputPayload;
  let lambdaStep;
  let provider;
  let queueGranulesExecutionArn;
  let testDataFolder;
  let testSuffix;
  let workflowExecution;
  let queueUrl;

  beforeAll(async () => {
    config = await loadConfig();
    lambdaStep = new LambdaStep();

    const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

    const s3data = [
      '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
      '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
    ];

    const testId = createTimestampedTestId(config.stackName, 'QueueGranules');
    testSuffix = createTestSuffix(testId);
    testDataFolder = createTestDataPath(testId);

    const inputPayloadFilename =
      './spec/parallel/queueGranules/QueueGranules.input.payload.json';

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
    const { QueueUrl } = await sqs().createQueue({ QueueName });
    queueUrl = QueueUrl;

    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    // update test data filepaths
    inputPayload = await setupTestGranuleForIngest(
      config.bucket,
      inputPayloadJson,
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
  });

  afterAll(async () => {
    // clean up stack state added by test
    await sqs().deleteQueue({
      QueueUrl: queueUrl,
    });
    await Promise.all(
      inputPayload.granules.map(async (granule) => {
        await waitForGranuleAndDelete(
          config.stackName,
          granule.granuleId,
          constructCollectionId(collection.name, collection.version),
          'queued'
        );
      })
    );

    await deleteExecution({
      prefix: config.stackName,
      executionArn: queueGranulesExecutionArn,
    });

    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      cleanupCollections(
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
              collectionId: constructCollectionId(collection.name, collection.version),
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
      expect(lambdaOutput.payload.running.length).toEqual(1);
    });
  });

  describe('the reporting lambda has received the CloudWatch step function event and', () => {
    it('the execution record is added to the PostgreSQL database', async () => {
      const record = await waitForApiStatus(
        getExecution,
        { prefix: config.stackName, arn: workflowExecution.executionArn },
        'completed'
      );
      expect(record.status).toEqual('completed');
    });
  });
});

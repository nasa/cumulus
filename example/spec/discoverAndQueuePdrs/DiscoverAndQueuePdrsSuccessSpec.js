const { Collection, Execution } = require('@cumulus/api/models');
const {
  buildAndExecuteWorkflow,
  waitForCompletedExecution,
  LambdaStep,
  addProviders,
  cleanupProviders,
  addCollections,
  cleanupCollections,
  api: apiTestUtils
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  updateAndUploadTestDataToBucket,
  deleteFolder,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix
} = require('../helpers/testUtils');

const config = loadConfig();
const lambdaStep = new LambdaStep();
const taskName = 'DiscoverAndQueuePdrs';
const pdrFilename = 'MOD09GQ_1granule_v3.PDR';

const s3data = [
  '@cumulus/test-data/pdrs/MOD09GQ_1granule_v3.PDR'
];

describe('The Discover And Queue PDRs workflow', () => {
  const testId = createTimestampedTestId(config.stackName, 'DiscoverAndQueuePdrsSuccess');
  const testSuffix = createTestSuffix(testId);
  const testDataFolder = createTestDataPath(testId);
  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';
  const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
  const provider = { id: `s3_provider${testSuffix}` };
  let workflowExecution;
  let queuePdrsOutput;
  process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
  process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
  const executionModel = new Execution();
  const collectionModel = new Collection();

  beforeAll(async () => {
    // delete pdr from old tests
    await apiTestUtils.deletePdr({
      prefix: config.stackName,
      pdr: pdrFilename
    });
    // populate collections, providers and test data
    await Promise.all([
      updateAndUploadTestDataToBucket(config.bucket, s3data, testDataFolder, [{ old: 'cumulus-test-data/pdrs', new: testDataFolder }, { old: 'DATA_TYPE = MOD09GQ;', new: `DATA_TYPE = MOD09GQ${testSuffix};` }]),
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix)
    ]);
    // update provider path
    await collectionModel.update(collection, { provider_path: testDataFolder });

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      taskName,
      collection,
      provider
    );

    queuePdrsOutput = await lambdaStep.getStepOutput(
      workflowExecution.executionArn,
      'QueuePdrs'
    );
  });

  afterAll(async () => {
    // clean up stack state added by test
    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix),
      apiTestUtils.deletePdr({
        prefix: config.stackName,
        pdr: pdrFilename
      })
    ]);
  });

  it('executes successfully', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('the DiscoverPdrs Lambda', () => {
    let lambdaOutput = null;

    beforeAll(async () => {
      lambdaOutput = await lambdaStep.getStepOutput(workflowExecution.executionArn, 'DiscoverPdrs');
    });

    it('has expected path and name output', () => {
      expect(lambdaOutput.payload.pdrs[0].path).toEqual(testDataFolder);
      expect(lambdaOutput.payload.pdrs[0].name).toEqual(pdrFilename);
    });
  });

  describe('the QueuePdrs Lambda', () => {
    it('has expected output', () => {
      expect(queuePdrsOutput.payload.pdrs_queued).toEqual(1);
      expect(queuePdrsOutput.payload.running.length).toEqual(1);
    });
  });

  /**
   * The DiscoverAndQueuePdrs workflow kicks off a ParsePdr workflow, so check that the
   * ParsePdr workflow completes successfully. Above, we checked that there is
   * one running task, which is the ParsePdr workflow. The payload has the arn of the
   * running workflow, so use that to get the status.
   */
  describe('ParsePdr workflow', () => {
    let parsePdrWorkflowArn;
    let parsePdrExecutionStatus;
    let parseLambdaOutput;

    beforeAll(async () => {
      parsePdrWorkflowArn = queuePdrsOutput.payload.running[0];
      console.log(`Wait for execution ${parsePdrWorkflowArn}`);
      parsePdrExecutionStatus = await waitForCompletedExecution(parsePdrWorkflowArn);
    });

    afterAll(async () => {
      // wait for child executions to complete
      const queueGranulesOutput = await lambdaStep.getStepOutput(
        parsePdrWorkflowArn,
        'QueueGranules'
      );
      await Promise.all(queueGranulesOutput.payload.running.map(async (arn) => {
        await waitForCompletedExecution(arn);
      }));
      await apiTestUtils.deleteGranule({
        prefix: config.stackName,
        granuleId: parseLambdaOutput.payload.granules[0].granuleId
      });
    });

    it('executes successfully', () => {
      expect(parsePdrExecutionStatus).toEqual('SUCCEEDED');
    });

    describe('ParsePdr lambda function', () => {
      it('successfully parses a granule from the PDR', async () => {
        parseLambdaOutput = await lambdaStep.getStepOutput(
          parsePdrWorkflowArn,
          'ParsePdr'
        );
        expect(parseLambdaOutput.payload.granules.length).toEqual(1);
      });
    });
  });

  /** This test relies on the previous 'ParsePdr workflow' to complete */
  describe('When accessing an execution via the API that was triggered from a parent step function', () => {
    it('displays a link to the parent', async () => {
      const parsePdrWorkflowArn = queuePdrsOutput.payload.running[0];
      const parsePdrExecution = await apiTestUtils.getExecution({
        prefix: config.stackName,
        arn: parsePdrWorkflowArn
      });

      expect(parsePdrExecution.parentArn).toEqual(workflowExecution.executionArn);
    });
  });

  describe('When accessing an execution via the API that was not triggered from a parent step function', () => {
    it('does not display a parent link', async () => {
      const queuePdrsExecution = await apiTestUtils.getExecution({
        prefix: config.stackName,
        arn: workflowExecution.executionArn
      });

      expect(queuePdrsExecution.parentArn).toBeUndefined();
    });
  });


  describe('the sf-sns-report task has published a sns message and', () => {
    it('the execution record is added to DynamoDB', async () => {
      const record = await executionModel.get({ arn: workflowExecution.executionArn });
      expect(record.status).toEqual('completed');
    });
  });
});

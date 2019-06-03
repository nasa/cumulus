'use strict';

const fs = require('fs-extra');

const {
  models: {
    Collection,
    Provider
  }
} = require('@cumulus/api');
const {
  aws: {
    s3
  },
  testUtils: {
    randomStringFromRegex
  },
  util: {
    sleep
  }
} = require('@cumulus/common');
const StepFunctions = require('@cumulus/common/StepFunctions');
const {
  api: apiTestUtils,
  buildAndExecuteWorkflow,
  LambdaStep,
  waitForExecutionExists
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  createTimestampedTestId,
  createTestSuffix,
  createTestDataPath,
  deleteFolder
} = require('../../helpers/testUtils');

const config = loadConfig();
const testId = createTimestampedTestId(config.stackName, 'QueueGranulesMax');
const testSuffix = createTestSuffix(testId);
const testDataFolder = createTestDataPath(testId);

const workflowName = 'QueueGranulesMax';

const stageTestData = (key, bucket, prefix) =>
  s3().putObject({
    Bucket: bucket,
    Key: `${prefix}/${key}`,
    Body: ''
  }).promise();

const uploadGranulesData = async ({
  numberOfGranules,
  granuleRegex,
  bucket,
  prefix
}) => {
  const granuleUploadPromises = new Array(numberOfGranules)
    .fill()
    .map(() => `${randomStringFromRegex(granuleRegex)}.hdf`)
    .map((key) => stageTestData(key, bucket, prefix));
  await Promise.all(granuleUploadPromises);
};

describe('Queues with maximum executions defined', () => {
  let workflowExecution;

  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';
  const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
  const provider = { id: `s3_provider${testSuffix}` };

  const maxExecutions = 5;
  const numberOfGranules = 6;

  const lambdaStep = new LambdaStep();

  process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
  const collectionModel = new Collection();
  process.env.ProvidersTable = `${config.stackName}-ProvidersTable`;
  const providerModel = new Provider();

  beforeAll(async () => {
    const collectionJson = JSON.parse(fs.readFileSync(`${collectionsDir}/s3_MOD09GQ_006.json`, 'utf8'));
    const granuleRegex = collectionJson.granuleId;
    const collectionData = Object.assign({}, collectionJson, {
      name: collection.name,
      dataType: collectionJson.dataType + testSuffix,
      provider_path: testDataFolder
    });

    const providerJson = JSON.parse(fs.readFileSync(`${providersDir}/s3_provider.json`, 'utf8'));
    const providerData = Object.assign({}, providerJson, {
      id: provider.id,
      host: config.bucket
    });

    await Promise.all([
      uploadGranulesData({
        numberOfGranules,
        granuleRegex,
        bucket: config.bucket,
        prefix: testDataFolder
      }),
      apiTestUtils.addCollectionApi({ prefix: config.stackName, collection: collectionData }),
      apiTestUtils.addProviderApi({ prefix: config.stackName, provider: providerData })
    ]);

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      workflowName,
      collection,
      provider
    );
  });

  afterAll(async () => {
    await Promise.all([
      collectionModel.delete(collection),
      providerModel.delete(provider),
      deleteFolder(config.bucket, testDataFolder)
    ]);
  });

  it('executes successfully', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });

  describe('respects the maximum amount of executions for the queue', () => {
    let queueGranulesOutput;
    let executionArns;

    beforeAll(async () => {
      queueGranulesOutput = await lambdaStep.getStepOutput(
        workflowExecution.executionArn,
        'QueueGranules'
      );
      executionArns = queueGranulesOutput.payload.running;
    });

    it('has expected count of queued executions', () => {
      expect(executionArns.length).toEqual(numberOfGranules);
    });

    it('is only running the maximum number of executions', async () => {
      let runningExecutions = 0;

      // Get the state for all of the queued execution ARNs.
      while (runningExecutions < maxExecutions) {
        const getExecutionStates = executionArns
          .map((arn) => StepFunctions.executionExists(arn));
        // eslint-disable-next-line no-await-in-loop
        const executionStates = await Promise.all(getExecutionStates);
        runningExecutions = executionStates.filter(Boolean).length;
        // eslint-disable-next-line no-await-in-loop
        await sleep(3000);
      }

      expect(runningExecutions).toEqual(maxExecutions);
    });
  });
});

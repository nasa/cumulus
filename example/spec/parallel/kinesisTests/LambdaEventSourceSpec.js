'use strict';

const {
  stringUtils: { globalReplace }
} = require('@cumulus/common');
const { Rule } = require('@cumulus/api/models');

jasmine.DEFAULT_TIMEOUT_INTERVAL = 9 * 60 * 1000;

const {
  addRulesWithPostfix,
  LambdaStep,
  addProviders,
  cleanupProviders,
  addCollections,
  cleanupCollections,
  rulesList,
  deleteRules
} = require('@cumulus/integration-tests');
const { randomString } = require('@cumulus/common/test-utils');

const {
  loadConfig,
  uploadTestDataToBucket,
  deleteFolder,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix
} = require('../../helpers/testUtils');

const {
  createOrUseTestStream,
  deleteTestStream,
  getStreamStatus,
  putRecordOnStream,
  tryCatchExit,
  waitForActiveStream,
  waitForAllTestSf
} = require('../../helpers/kinesisHelpers');

const testConfig = loadConfig();
const testId = createTimestampedTestId(testConfig.stackName, 'LambdaEventSourceTest');
const testSuffix = createTestSuffix(testId);
const testDataFolder = createTestDataPath(testId);
const ruleSuffix = globalReplace(testSuffix, '-', '_');
const lambdaStep = new LambdaStep();

process.env.ExecutionsTable = `${testConfig.stackName}-ExecutionsTable`;

const ruleDirectory = './spec/parallel/kinesisTests/data/lambdaEventSourceTestRules';
const s3data = ['@cumulus/test-data/granules/L2_HR_PIXC_product_0001-of-4154.h5'];

// When kinesis-type rules exist, the Cumulus lambda messageConsumer is
// configured to trigger workflows when new records arrive on a Kinesis
// stream. When a record appears on the stream, the messageConsumer lambda
// triggers workflows associated with the kinesis-type rules.
describe('When adding multiple rules that share a kinesis event stream', () => {
  const maxWaitForSFExistSecs = 60 * 4;

  const providersDir = './data/providers/PODAAC_SWOT/';
  const collectionsDir = './data/collections/L2_HR_PIXC-000/';
  const collectionsDirMOD09GQ = './data/collections/s3_MOD09GQ_006/';

  const streamName = `${testId}-LambdaEventSourceTestStream`;
  testConfig.streamName = streamName;

  let rules;

  async function cleanUp() {
    // delete rules
    const rulesToDelete = await rulesList(testConfig.stackName, testConfig.bucket, ruleDirectory);
    // clean up stack state added by test
    console.log(`\nCleaning up stack & deleting test stream '${streamName}'`);
    await deleteRules(testConfig.stackName, testConfig.bucket, rulesToDelete, ruleSuffix);
    await Promise.all([
      deleteFolder(testConfig.bucket, testDataFolder),
      cleanupCollections(testConfig.stackName, testConfig.bucket, collectionsDir, testSuffix),
      cleanupCollections(testConfig.stackName, testConfig.bucket, collectionsDirMOD09GQ, testSuffix),
      cleanupProviders(testConfig.stackName, testConfig.bucket, providersDir, testSuffix),
      deleteTestStream(streamName)
    ]);
  }

  beforeAll(async () => {
    // populate collections, providers and test data
    await Promise.all([
      uploadTestDataToBucket(testConfig.bucket, s3data, testDataFolder),
      addCollections(testConfig.stackName, testConfig.bucket, collectionsDir, testSuffix),
      addCollections(testConfig.stackName, testConfig.bucket, collectionsDirMOD09GQ, testSuffix),
      addProviders(testConfig.stackName, testConfig.bucket, providersDir, testConfig.bucket, testSuffix)
    ]);
    // create streams
    await tryCatchExit(cleanUp, async () => {
      await createOrUseTestStream(streamName);
      console.log(`\nWaiting for active stream: '${streamName}'.`);
      await waitForActiveStream(streamName);
      rules = await addRulesWithPostfix(testConfig, ruleDirectory, {}, testSuffix);
    });
  });

  afterAll(async () => {
    await cleanUp();
  });

  it('Prepares a kinesis stream for integration tests.', async () => {
    expect(await getStreamStatus(streamName)).toBe('ACTIVE');
  });

  describe('When the MOD09GQ rule is disabled and a L2_HR_PIXC record is dropped on the stream ', () => {
    let workflowExecutions;
    const recordIdentifier = randomString();

    beforeAll(async () => {
      await tryCatchExit(cleanUp, async () => {
        // Disable rule
        console.log(`Disabling rule ${rules[1].name}`);
        const r = new Rule();
        await r.update(rules[1], { state: 'DISABLED' });

        const record = {
          provider: `SWOT_PODAAC${testSuffix}`,
          collection: `L2_HR_PIXC${testSuffix}`,
          bucket: 'random-bucket',
          identifier: recordIdentifier
        };

        console.log(`Dropping record onto ${streamName}, recordIdentifier: ${recordIdentifier}.`);
        await putRecordOnStream(streamName, record);

        console.log('Waiting for step function to start...');
        workflowExecutions = await waitForAllTestSf(recordIdentifier, rules[1].workflow, maxWaitForSFExistSecs, 2);
      });
    });

    it('runs the HelloWorldWorkflow for L2_HR_PIXC and not MOD09GQ', async () => {
      expect(workflowExecutions.length).toEqual(1);

      const taskInput = await lambdaStep.getStepInput(workflowExecutions[0].executionArn, 'SfSnsReport');
      console.log(taskInput);

      expect(taskInput.meta.collection.name).toEqual(`L2_HR_PIXC${testSuffix}`);
    });
  });
});

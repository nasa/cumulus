'use strict';

const { stringUtils: { globalReplace } } = require('@cumulus/common');
const { randomString } = require('@cumulus/common/test-utils');
const { sleep } = require('@cumulus/common/util');
const { Rule } = require('@cumulus/api/models');

const {
  api: apiTestUtils,
  addCollections,
  addProviders,
  addRulesWithPostfix,
  cleanupCollections,
  cleanupProviders,
  deleteRules,
  rulesList
} = require('@cumulus/integration-tests');

const {
  createOrUseTestStream,
  deleteTestStream,
  getStreamStatus,
  putRecordOnStream,
  tryCatchExit,
  waitForActiveStream,
  waitForAllTestSf
} = require('../../helpers/kinesisHelpers');

const {
  loadConfig,
  deleteFolder,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix
} = require('../../helpers/testUtils');

// When kinesis-type rules exist, the Cumulus lambda messageConsumer is
// configured to trigger workflows when new records arrive on a Kinesis
// stream. When records arrive on the stream during an outage, the replays
// endpoint can be used to create an AsyncOperation which processes the
// records from a specified time period and triggers workflows associated
// with the kinesis-type rules.
describe('The Kinesis Replay API', () => {
  const maxWaitForSFExistSecs = 60 * 3;

  const ruleDir = './spec/parallel/kinesisTests/data/kinesisReplayRules';
  const providersDir = './data/providers/PODAAC_SWOT/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006/';

  let testConfig;
  let testDataFolder;
  let testSuffix;
  let ruleSuffix;
  let rules;

  let streamName;

  let tooOldToFetchRecords;
  let targetedRecords;
  let newRecordsToSkip;

  async function cleanUp() {
    // delete rules
    const rulesToDelete = await rulesList(testConfig.stackName, testConfig.bucket, ruleDir);
    // clean up stack state added by test
    console.log(`\nCleaning up stack & deleting test stream '${streamName}'`);
    try {
      await deleteRules(testConfig.stackName, testConfig.bucket, rulesToDelete, ruleSuffix);
      await Promise.all([
        deleteFolder(testConfig.bucket, testDataFolder),
        cleanupCollections(testConfig.stackName, testConfig.bucket, collectionsDir, testSuffix),
        cleanupProviders(testConfig.stackName, testConfig.bucket, providersDir, testSuffix),
        deleteTestStream(streamName)
      ]);
    } catch (e) {
      console.log(`Cleanup failed, ${e}.   Stack may need to be manually cleaned up.`);
    }
  }

  beforeAll(async () => {
    testConfig = await loadConfig();
    const testId = createTimestampedTestId(testConfig.stackName, 'KinesisReplayTest');
    testSuffix = createTestSuffix(testId);
    testDataFolder = createTestDataPath(testId);
    ruleSuffix = globalReplace(testSuffix, '-', '_');

    streamName = `${testId}-ReplayTestStream`;
    testConfig.streamName = streamName;

    const createRecord = (identifier) => ({
      provider: `SWOT_PODAAC${testSuffix}`,
      collection: `MOD09GQ${testSuffix}`,
      bucket: 'random-bucket',
      identifier: identifier || randomString()
    });

    tooOldToFetchRecords = [createRecord(`too-old-${testId}`)];
    targetedRecords = [createRecord(), createRecord()];
    newRecordsToSkip = [createRecord(`too-new-${testId}`)];

    await Promise.all([
      addCollections(testConfig.stackName, testConfig.bucket, collectionsDir, testSuffix),
      addProviders(testConfig.stackName, testConfig.bucket, providersDir, testConfig.bucket, testSuffix)
    ]);

    await tryCatchExit(cleanUp, async () => {
      await createOrUseTestStream(streamName);
      console.log(`\nWaiting for active stream: '${streamName}'.`);
      await waitForActiveStream(streamName);
      rules = await addRulesWithPostfix(testConfig, ruleDir, {}, testSuffix);
    });
  });

  afterAll(async () => {
    await cleanUp();
  });

  it('Prepares a kinesis stream for integration tests.', async () => {
    expect(await getStreamStatus(streamName)).toBe('ACTIVE');
  });

  describe('when a valid kinesis replay request is made', () => {
    let startTimestamp;
    let endTimestamp;
    let asyncOperationId;

    beforeAll(async () => {
      // delete EventSourceMapping so that our rule, though enabled, does not trigger duplicate executions
      const rule = new Rule();
      await rule.deleteKinesisEventSources(rules[0]);

      await Promise.all(tooOldToFetchRecords.map((r) => putRecordOnStream(streamName, r)));
      await sleep(10 * 1000);
      startTimestamp = Date.now();
      await sleep(5 * 1000);
      await Promise.all(targetedRecords.map((r) => putRecordOnStream(streamName, r)));
      await sleep(5 * 1000);
      endTimestamp = Date.now();
      await sleep(10 * 1000);
      await Promise.all(newRecordsToSkip.map((r) => putRecordOnStream(streamName, r)));

      const apiRequestBody = {
        type: 'kinesis',
        kinesisStream: streamName,
        endTimestamp,
        startTimestamp
      };
      const response = await apiTestUtils.callCumulusApi({
        prefix: testConfig.stackName,
        payload: {
          httpMethod: 'POST',
          resource: '/{proxy+}',
          headers: {
            'Content-Type': 'application/json'
          },
          path: '/replays',
          body: JSON.stringify(apiRequestBody)
        }
      });
      console.log(`received response ${JSON.stringify(response)}`);
      asyncOperationId = JSON.parse(response.body).asyncOperationId;
    });

    it('starts an AsyncOperation and returns the AsyncOperationId', () => {
      expect(asyncOperationId).toBeDefined();
    });

    describe('processes messages within the specified time slice', () => {
      it('to start workflows', async () => {
        console.log('Waiting for step functions to start...');
        const workflowExecutions = await Promise.all(targetedRecords.map((record) => waitForAllTestSf(
          record.identifier,
          rules[0].workflow,
          maxWaitForSFExistSecs,
          1,
          'HelloWorld'
        ).catch((err) => fail(err.message))));
        // if intermittent failures occur here, consider increasing maxWaitForSFExistSecs
        expect(workflowExecutions.length).toEqual(2);
        workflowExecutions.forEach((exArr) => expect(exArr.length).toEqual(1));
      });
    });

    it('does not fetch messages older than the time slice', async () => {
      await Promise.all(tooOldToFetchRecords
        .map((r) => waitForAllTestSf(
          r.identifier,
          rules[0].workflow,
          maxWaitForSFExistSecs,
          1,
          'HelloWorld'
        )
          .then((ex) => fail(`should not find executions but found ${JSON.stringify(ex)}`))
          .catch((err) => expect(err.message).toBe('Never found started workflow.'))));
    });

    it('skips processing of messages newer than the time slice', async () => {
      await Promise.all(newRecordsToSkip
        .map((r) => waitForAllTestSf(
          r.identifier,
          rules[0].workflow,
          maxWaitForSFExistSecs,
          1,
          'HelloWorld'
        )
          .then((ex) => fail(`should not find executions but found ${JSON.stringify(ex)}`))
          .catch((err) => expect(err.message).toBe('Never found started workflow.'))));
    });
  });
});

'use strict';

const fs = require('fs');

const {
  aws: { deleteSQSMessage },
  testUtils: { randomString },
  stringUtils: { globalReplace }
} = require('@cumulus/common');

const { sleep } = require('@cumulus/common/util');

const {
  addRules,
  deleteRules,
  addProviders,
  cleanupProviders,
  addCollections,
  cleanupCollections,
  rulesList
} = require('@cumulus/integration-tests');

const {
  createOrUseTestStream,
  deleteTestStream,
  getStreamStatus,
  kinesisEventFromSqsMessage,
  putRecordOnStream,
  tryCatchExit,
  waitForActiveStream,
  waitForQueuedRecord
} = require('../../helpers/kinesisHelpers');

const {
  loadConfig,
  createTimestampedTestId,
  createTestSuffix,
  createTestDataPath
} = require('../../helpers/testUtils');

const testConfig = loadConfig();
const testId = createTimestampedTestId(testConfig.stackName, 'KinesisTestError');
const testSuffix = createTestSuffix(testId);
const testDataFolder = createTestDataPath(testId);
const ruleSuffix = globalReplace(testSuffix, '-', '_');


const record = JSON.parse(fs.readFileSync(`${__dirname}/data/records/L2_HR_PIXC_product_0001-of-4154.json`));
record.product.files[0].uri = globalReplace(record.product.files[0].uri, 'cumulus-test-data/pdrs', testDataFolder);
record.provider += testSuffix;
record.collection += testSuffix;

const ruleDirectory = './spec/parallel/kinesisTests/data/rules';
const ruleOverride = {
  name: `L2_HR_PIXC_kinesisRule${ruleSuffix}`,
  collection: {
    name: record.collection,
    version: '000'
  },
  provider: record.provider
};

describe('The messageConsumer receives a bad record.\n', () => {
  const providersDir = './data/providers/PODAAC_SWOT/';
  const collectionsDir = './data/collections/L2_HR_PIXC-000/';

  const testRecordIdentifier = randomString();
  record.identifier = testRecordIdentifier;
  const badRecord = { ...record };
  delete badRecord.collection;

  const streamName = `${testId}-KinesisTestErrorStream`;
  testConfig.streamName = streamName;
  const failureSqsUrl = `https://sqs.${testConfig.awsRegion}.amazonaws.com/${testConfig.awsAccountId}/${testConfig.prefix}-kinesisFailure`;

  async function cleanUp() {
    if (this.ReceiptHandle) {
      console.log('Delete the Record from the queue.');
      await deleteSQSMessage(failureSqsUrl, this.ReceiptHandle);
    }
    console.log(`\nDeleting ${ruleOverride.name}`);
    const rules = await rulesList(testConfig.stackName, testConfig.bucket, ruleDirectory);
    // clean up stack state added by test
    console.log(`\nDeleting testStream '${streamName}'`);
    await Promise.all([
      cleanupCollections(testConfig.stackName, testConfig.bucket, collectionsDir, testSuffix),
      cleanupProviders(testConfig.stackName, testConfig.bucket, providersDir, testSuffix),
      deleteRules(testConfig.stackName, testConfig.bucket, rules, ruleSuffix),
      deleteTestStream(streamName)
    ]);
    jasmine.DEFAULT_TIMEOUT_INTERVAL = this.defaultTimeout;
  }

  beforeAll(async () => {
    // populate collections, providers and test data
    await Promise.all([
      addCollections(testConfig.stackName, testConfig.bucket, collectionsDir, testSuffix),
      addProviders(testConfig.stackName, testConfig.bucket, providersDir, testConfig.bucket, testSuffix)
    ]);
    this.defaultTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 10 * 60 * 1000;
    await tryCatchExit(cleanUp.bind(this), async () => {
      await createOrUseTestStream(streamName);
      console.log(`\nWaiting for active streams: '${streamName}'.`);
      await waitForActiveStream(streamName);
      await addRules(testConfig, ruleDirectory, ruleOverride);
      console.log(`\nDropping record onto  ${streamName}, testRecordIdentifier: ${testRecordIdentifier}.`);
      await putRecordOnStream(streamName, badRecord);
    });
  });

  afterAll(async () => {
    try {
      await cleanUp.bind(this)();
    }
    catch (e) {
      console.log(`Cleanup Failed ${e}`);
    }
  });

  it('Prepares a kinesis stream for integration tests.', async () => {
    expect(await getStreamStatus(streamName)).toBe('ACTIVE');
  });

  it('Eventually puts the bad record on the failure queue.', async () => {
    console.log('\nWait for minimum duration of failure process ~3.5 min');
    await sleep(3.5 * 60 * 1000);
    console.log('\nWait for record on:', failureSqsUrl);
    const queuedRecord = await waitForQueuedRecord(testRecordIdentifier, failureSqsUrl);
    this.ReceiptHandle = queuedRecord.ReceiptHandle;
    const queuedKinesisEvent = kinesisEventFromSqsMessage(queuedRecord);
    expect(queuedKinesisEvent).toEqual(badRecord);
  });
});

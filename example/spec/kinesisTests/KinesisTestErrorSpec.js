'use strict';

const {
  testUtils: { randomString },
  aws: { deleteSQSMessage }
} = require('@cumulus/common');

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
  timeStampedStreamName,
  tryCatchExit,
  waitForActiveStream,
  waitForQueuedRecord
} = require('../helpers/kinesisHelpers');

const { loadConfig, timestampedTestPrefix } = require('../helpers/testUtils');
const record = require('./data/records/L2_HR_PIXC_product_0001-of-4154.json');

const ruleDirectory = './spec/kinesisTests/data/rules';
const ruleOverride = {
  collection: {
    name: record.collection
  },
  provider: record.provider
};

describe('The kinesisConsumer receives a bad record.', () => {
  const testConfig = loadConfig();
  const providersDir = './data/providers/PODAAC_SWOT/';
  const collectionsDir = './data/collections/L2_HR_PIXC-000/';

  const testPostfix = timestampedTestPrefix(`_${testConfig.stackName}-KinesisTestError`);
  const testRecordIdentifier = randomString();
  record.identifier = testRecordIdentifier;
  const badRecord = { ...record };
  delete badRecord.collection;

  const streamName = timeStampedStreamName(testConfig, 'KinesisError');
  testConfig.streamName = streamName;
  const failureSqsUrl = `https://sqs.${testConfig.awsRegion}.amazonaws.com/${testConfig.awsAccountId}/${testConfig.stackName}-kinesisFailure`;

  beforeAll(async () => {
    // populate collections, providers and test data
    await Promise.all([
      await addCollections(testConfig.stackName, testConfig.bucket, collectionsDir, testPostfix),
      await addProviders(testConfig.stackName, testConfig.bucket, providersDir, testPostfix)
    ]);
    this.defaultTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 10 * 60 * 1000;
    this.maxNumberElapsedPeriods = jasmine.DEFAULT_TIMEOUT_INTERVAL / 5000;
    await tryCatchExit(async () => {
      await createOrUseTestStream(streamName);
      console.log(`\nWaiting for active streams: '${streamName}'.`);
      await waitForActiveStream(streamName);
      console.log('\nSetting up kinesisRule');
      await addRules(testConfig, ruleDirectory, ruleOverride);
      console.log(`\nDropping record onto  ${streamName}, testRecordIdentifier: ${testRecordIdentifier}.`);
      await putRecordOnStream(streamName, badRecord);
    });
  });

  afterAll(async () => {
    if (this.ReceiptHandle) {
      console.log('Delete the Record from the queue.');
      await deleteSQSMessage(failureSqsUrl, this.ReceiptHandle);
    }
    console.log('\nDeleting kinesisRule');
    const rules = await rulesList(testConfig.stackName, testConfig.bucket, ruleDirectory);
    await deleteRules(testConfig.stackName, testConfig.bucket, rules);
    // clean up stack state added by test
    await Promise.all([
      await cleanupCollections(testConfig.stackName, testConfig.bucket, collectionsDir, testPostfix),
      await cleanupProviders(testConfig.stackName, testConfig.bucket, providersDir, testPostfix)
    ]);
    console.log(`\nDeleting testStream '${streamName}'`);
    await deleteTestStream(streamName);
    jasmine.DEFAULT_TIMEOUT_INTERVAL = this.defaultTimeout;
  });

  it('Prepares a kinesis stream for integration tests.', async () => {
    expect(await getStreamStatus(streamName)).toBe('ACTIVE');
  });

  it('Eventually puts the bad record on the failure queue.', async () => {
    console.log('\nWait for minimum duration of failure process ~3min');
    console.log('\nWait for record on:', failureSqsUrl);
    const queuedRecord = await waitForQueuedRecord(testRecordIdentifier, failureSqsUrl, this.maxNumberElapsedPeriods);
    this.ReceiptHandle = queuedRecord.ReceiptHandle;
    const queuedKinesisEvent = kinesisEventFromSqsMessage(queuedRecord);
    expect(queuedKinesisEvent).toEqual(badRecord);
  });
});

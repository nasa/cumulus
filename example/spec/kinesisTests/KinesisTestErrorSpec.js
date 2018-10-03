'use strict';

const {
  testUtils: { randomString },
  aws: { deleteSQSMessage }
} = require('@cumulus/common');

const { addRules, deleteRules, rulesList } = require('@cumulus/integration-tests');

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

const { loadConfig } = require('../helpers/testUtils');

const record = require('./data/records/L2_HR_PIXC_product_0001-of-4154.json');

describe('The kinesisConsumer receives a bad record.', () => {
  const testRecordIdentifier = randomString();
  record.identifier = testRecordIdentifier;
  const badRecord = { ...record };
  delete badRecord.collection;

  const testConfig = loadConfig();
  const streamName = timeStampedStreamName(testConfig, 'KinesisError');
  testConfig.streamName = streamName;
  const ruleDirectory = './spec/kinesisTests/data/rules';
  const failureSqsUrl = `https://sqs.${testConfig.awsRegion}.amazonaws.com/${testConfig.awsAccountId}/${testConfig.stackName}-kinesisFailure`;

  async function cleanUp() {
    if (this.ReceiptHandle) {
      console.log('Delete the Record from the queue.');
      await deleteSQSMessage(failureSqsUrl, this.ReceiptHandle);
    }
    console.log('\nDeleting kinesisRule');
    const rules = await rulesList(testConfig.stackName, testConfig.bucket, ruleDirectory);
    await deleteRules(testConfig.stackName, testConfig.bucket, rules);
    console.log(`\nDeleting testStream '${streamName}'`);
    await deleteTestStream(streamName);
    jasmine.DEFAULT_TIMEOUT_INTERVAL = this.defaultTimeout;
  }

  beforeAll(async () => {
    this.defaultTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 15 * 60 * 1000;
    this.maxNumberElapsedPeriods = jasmine.DEFAULT_TIMEOUT_INTERVAL / 5000;
    await tryCatchExit(cleanUp.bind(this), async () => {
      await createOrUseTestStream(streamName);
      console.log(`\nWaiting for active streams: '${streamName}'.`);
      await waitForActiveStream(streamName);
      console.log('\nSetting up kinesisRule');
      await addRules(testConfig, ruleDirectory);
      console.log(`\nDropping record onto  ${streamName}, testRecordIdentifier: ${testRecordIdentifier}.`);
      await putRecordOnStream(streamName, badRecord);
    });
  });

  afterAll(async () => {
    try {
      await cleanUp.bind(this)();
    }
    catch (e) {
      console.log(`Cleanup Failed ${e}`)
    }
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

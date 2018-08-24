'use strict';

const {
  testUtils: {
    randomString
  },
  aws: {
    deleteSQSMessage
  }
} = require('@cumulus/common');

const {
  createOrUseTestStream,
  kinesisEventFromSqsMessage,
  putRecordOnStream,
  tryCatchExit,
  waitForActiveStream,
  waitForQueuedRecord
} = require('../helpers/kinesisHelpers');

const { loadConfig } = require('../helpers/testUtils');

const record = require('../../data/records/L2_HR_PIXC_product_0001-of-4154.json');
const testRecordIdentifier = randomString();
record.identifier = testRecordIdentifier;
const badRecord = { ...record };
delete badRecord.collection;


const testConfig = loadConfig();
const streamName = testConfig.streamName;
const failureSqsUrl = `https://sqs.${testConfig.awsRegion}.amazonaws.com/${testConfig.awsAccountId}/${testConfig.stackName}-kinesisFailure`;


describe('The kinesisConsumer receives a bad record.', () => {
  beforeAll(async () => {
    this.defaultTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 10 * 60 * 1000;
    this.maxNumberElapsedPeriods = jasmine.DEFAULT_TIMEOUT_INTERVAL / 5000;
    await tryCatchExit(async () => {
      await createOrUseTestStream(streamName);
      console.log(`\nWaiting for active streams: '${streamName}'.`);
      await waitForActiveStream(streamName);
      console.log(`Dropping record onto  ${streamName}, testRecordIdentifier: ${testRecordIdentifier}.`);
      await putRecordOnStream(streamName, badRecord);
    });
  });

  afterAll(async () => {
    if (this.ReceiptHandle) {
      console.log('Delete the Record from the queue.');
      await deleteSQSMessage(failureSqsUrl, this.ReceiptHandle);
    }
    jasmine.DEFAULT_TIMEOUT_INTERVAL = this.defaultTimeout;
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

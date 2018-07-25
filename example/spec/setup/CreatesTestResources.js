const { loadConfig } = require('../helpers/testUtils');
const { createOrUseTestStream, waitForActiveStream } = require('../helpers/kinesisHelpers');
const { Kinesis } = require('aws-sdk');
const testConfig = loadConfig();
const kinesis = new Kinesis({ apiVersion: '2013-12-02', region: testConfig.awsRegion });


jasmine.DEFAULT_TIMEOUT_INTERVAL = 550000;

describe('Creates Necessary Test Resources', () => {
  beforeAll(async () => {
    try {
      await createOrUseTestStream(testConfig.streamName);
      await waitForActiveStream(testConfig.streamName);
    }
    catch (error) {
      console.log(error);
      console.log('failed to set up necessary test resources...exiting.');
      process.exit(1);
    }
  });

  it('Prepares a kinesis stream for integration tests.', async () => {
    const stream = await kinesis.describeStream({ StreamName: testConfig.streamName }).promise();
    expect(stream.StreamDescription.StreamStatus).toBe('ACTIVE');
  });
});

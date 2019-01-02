const { Lambda } = require('aws-sdk');
const { s3 } = require('@cumulus/common/aws');
const { loadConfig } = require('../helpers/testUtils');

const config = loadConfig();

const testBucket = `${config.stackName}-s3directaccess-bucket`;

/**
 * Calls the s3AccessTest lambda in the given region, which returns
 * true or false based on whether test s3 object can be accessed from the
 * lambda
 *
 * @param {string} region - AWS region
 * @returns {string} - 'true' or 'false'
 */
async function canAccessObject(region) {
  const lambda = new Lambda({ region });

  const data = await lambda.invoke({
    FunctionName: `${config.stackName}-S3AccessTest`,
    Payload: JSON.stringify({ Bucket: testBucket, Key: 'test.txt' })
  }).promise();

  return data.Payload;
}

/**
 * Create a message formatted like an sns message to send to the lambda
 * The bucket would not normally be included in this message, but is used
 * for this test
 *
 * @returns {Object} SNS-type message
 */
function createSnsMessage() {
  const message = {
    synctoken: '0123456789',
    md5: '6a45316e8bc9463c9e926d5d37836d33',
    url: 'https://ip-ranges.amazonaws.com/ip-ranges.json',
    bucket: testBucket // only needed for testing purposes
  };

  message['create-time'] = '2018-04-24T10:00:s00+00:00';

  const Records = [{
    Sns: { Message: JSON.stringify(message) }
  }];

  return { Records };
}

// Removing these tests for now. With NGAP permissions boundaries, we do not have
// permission to update a bucket policy
// Will be resolved with NGAP-3647
xdescribe('The S3 bucket', () => {
  beforeAll(async () => {
    await s3().createBucket({ Bucket: testBucket }).promise();

    await s3().putObject({ Bucket: testBucket, Key: 'test.txt', Body: 'test' }).promise();

    const snsMessage = createSnsMessage();

    const lambda = new Lambda();

    // Invoke the lambda to set the bucket policy
    await lambda.invoke({
      FunctionName: `${config.stackName}-InRegionS3Policy`,
      Payload: JSON.stringify(snsMessage)
    }).promise();
  });

  afterAll(async () => {
    await s3().deleteObject({ Bucket: testBucket, Key: 'test.txt' }).promise();
    await s3().deleteBucket({ Bucket: testBucket }).promise();
  });

  it('is accessible from us-east-1', async () => {
    expect(await canAccessObject('us-east-1')).toEqual('true');
  });

  xit('is not accessible from us-west-1', async () => {
    expect(await canAccessObject('us-west-1')).toEqual('false');
  });
});

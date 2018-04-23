const { Lambda } = require('aws-sdk');
const { loadConfig } = require('../helpers/testUtils');
const { s3 } = require('@cumulus/common/aws');

const config = loadConfig();

const testBucket = `${config.prefix}-s3directaccess`;

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

describe('The S3 bucket', () => {
  beforeAll(async () => {
    await s3().createBucket({ Bucket: testBucket }).promise();

    await s3().putObject({ Bucket: testBucket, Key: 'test.txt', Body: 'test' }).promise();

    const lambda = new Lambda();

    // Invoke the lambda to set the bucket policy
    await lambda.invoke({
      FunctionName: `${config.stackName}-InRegionS3Policy`,
      Payload: JSON.stringify({
        synctoken: '0123456789',
        md5: '6a45316e8bc9463c9e926d5d37836d33',
        url: 'https://ip-ranges.amazonaws.com/ip-ranges.json',
        bucket: testBucket
      })
    }).promise();
  });

  afterAll(async () => {
    await s3().deleteObject({ Bucket: testBucket, Key: 'test.txt' }).promise();
    await s3().deleteBucket({ Bucket: testBucket }).promise();
  });

  it('is accessible from us-east-1', async () => {
    expect(await canAccessObject('us-east-1')).toEqual('true');
  });

  it('is not accessible from us-west-1', async () => {
    expect(await canAccessObject('us-west-1')).toEqual('false');
  });
});

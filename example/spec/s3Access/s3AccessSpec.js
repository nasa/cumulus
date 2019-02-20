const { Lambda } = require('aws-sdk');
const { s3 } = require('@cumulus/common/aws');
const { loadConfig } = require('../helpers/testUtils');

const config = loadConfig();

const testFileKey = `${config.stackName}-s3AccessTest/test.txt`;
const protectedBucket = config.buckets.protected.name;

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
    Payload: JSON.stringify({ Bucket: protectedBucket, Key: testFileKey })
  }).promise();

  return data.Payload;
}

/**
 * TO DO:
 * Call the credential API endpoint
 * Update canAccessObject to take in the keys returned and the lambda use them to initizialize the
 *    S3 object to try to grab the object in the bucket
 */
describe('The S3 bucket', () => {
  beforeAll(async () => {
    await s3().putObject({ Bucket: protectedBucket, Key: testFileKey, Body: 'test' }).promise();
  });

  afterAll(async () => {
    await s3().deleteObject({ Bucket: protectedBucket, Key: testFileKey }).promise();
  });

  it('is accessible from us-east-1', async () => {
    expect(await canAccessObject('us-east-1')).toEqual('true');
  });

  xit('is not accessible from us-west-1', async () => {
    expect(await canAccessObject('us-west-1')).toEqual('false');
  });
});

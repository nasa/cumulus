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
 * TO DO:
 * test bucket should be the protected bucket
 * Put an object in the bucket
 * Call the credential API endpoint
 * Update canAccessObject to take in the keys returned and the lambda use them to initizialize the
 *    S3 object to try to grab the object in the bucket
 */
xdescribe('The S3 bucket', () => {
  beforeAll(async () => {
    await s3().createBucket({ Bucket: testBucket }).promise();

    await s3().putObject({ Bucket: testBucket, Key: 'test.txt', Body: 'test' }).promise();
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

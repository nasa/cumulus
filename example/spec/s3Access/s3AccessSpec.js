/* eslint disable */

const { Lambda, S3 } = require('aws-sdk');
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
describe('When accessing a bucket directly', () => {
  beforeAll(async () => {
    await s3().putObject({ Bucket: protectedBucket, Key: testFileKey, Body: 'test' }).promise();
  });

  afterAll(async () => {
    await s3().deleteObject({ Bucket: protectedBucket, Key: testFileKey }).promise();
  });

  describe('with credentials associated with an Earthdata Login ID', () => {
    let credentials;
    let s3EdlCreds;

    beforeAll(async () => {
      /**
       * TO DO:
       * Fetch the credentials from the endpoint
       */
      // credentials = .....

      // s3EdlCreds = new S3({
      //   apiVersion: '2006-03-01',
      //   accessKeyId: credentials.AccessKeyId,
      //   secretAccessKey: credentials.SecretAccessKey
      // });
    });

    it('the data can be downloaded from within the same region', () => {

    });

    it('a write from the same region is rejected', () => {

    });

    it('the bucket contents can be listed from within the same region', () => {

    });

    it('when fetching data in a different region, it does not download the file', () => {

    });
  });
});

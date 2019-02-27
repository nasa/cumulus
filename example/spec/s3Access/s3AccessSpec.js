const { Lambda } = require('aws-sdk');
const { s3 } = require('@cumulus/common/aws');
const { api: { callCumulusApi } } = require('@cumulus/integration-tests');
const { loadConfig } = require('../helpers/testUtils');

const config = loadConfig();

const testFileKey = `${config.stackName}-s3AccessTest/test.txt`;
const protectedBucket = config.buckets.protected.name;

/**
 * Calls the s3AccessTest lambda in the given region, which returns
 * true or false based on whether test on the s3 Object passes or fails.
 *
 * @param {string} region - AWS region to run test from
 * @param {AWS.credentials} credentials - AWS.credentials object for direct s3 access
 * @param {string} testName - test to invoke from lambda can be 'list-object',
 *                            'get-object' or 'write-object'
 * @returns {Object} - lambda payload
 */
async function invokeTestLambda(region, credentials, testName) {
  const lambda = new Lambda({ region });

  const data = await lambda.invoke({
    FunctionName: `${config.stackName}-S3AccessTest`,
    Payload: JSON.stringify({
      Bucket: protectedBucket,
      Key: testFileKey,
      credentials,
      testName
    })
  }).promise();

  return data.Payload;
}

/**
 * Calls the s3AccessTest lambda in the given region, which returns
 * true if the S3 Object can be read, false otherwise.
 *
 * @param {string} region - AWS region
 * @param {Object} credentials - AWS.credentials object
 * @returns {string} - 'true' or 'false'
 */
async function canGetObject(region, credentials) {
  return invokeTestLambda(region, credentials, 'get-object');
}

/**
 * Calls the s3AccessTest lambda in the given region, and runs the write-object
 * tests which returns false if an S3 Object can be written to the protected
 * bucket, false otherwise.
 * @param {string} region - aws region
 * @param {AWS.Credentials} credentials - credential object
 * @returns {string} - 'true' or 'false'
 */
async function canWriteObject(region, credentials) {
  return invokeTestLambda(region, credentials, 'write-object');
}

/**
 * Calls the s3AccessTest lambda in the given region, and runs the list-objects
 * test which returns true if the protected buckets objects can be listed, false otherwise.
 * @param {string} region - aws region
 * @param {AWS.Credentials} credentials - credential object
 * @returns {string} - 'true' or 'false'
 */
async function canListObjects(region, credentials) {
  return invokeTestLambda(region, credentials, 'list-objects');
}

describe('When accessing an S3 bucket directly', () => {
  beforeAll(async () => {
    await s3().putObject({ Bucket: protectedBucket, Key: testFileKey, Body: 'test' }).promise();
  });

  afterAll(async () => {
    await s3().deleteObject({ Bucket: protectedBucket, Key: testFileKey }).promise();
  });

  describe('with credentials associated with an Earthdata Login ID', () => {
    let credentials;

    beforeAll(async () => {
      const payload = await callCumulusApi({
        prefix: `${config.stackName}`,
        payload: {
          httpMethod: 'GET',
          resource: '/{proxy+}',
          path: '/s3credentials'
        }
      });
      credentials = JSON.parse(payload.body);
    });

    describe('while in the the same region ', () => {
      it('the bucket contents can be listed', async () => {
        expect(await canListObjects('us-east-1', credentials)).toBe('true');
      });

      it('the data can be downloaded', async () => {
        expect(await canGetObject('us-east-1', credentials)).toBe('true');
      });

      it('a write is rejected', async () => {
        expect(await canWriteObject('us-east-1', credentials)).toBe('false');
      });
    });

    describe('while outside the region ', () => {
      const pendingReason = '2019-02-25: MHS - NGAP same-region policy not deployed completely';
      it('the bucket contents can NOT be listed', async () => {
        expect(await canListObjects('us-west-2', credentials)).toBe('false');
      }).pend(pendingReason);

      it('the data can NOT be downloaded', async () => {
        expect(await canGetObject('us-west-2', credentials)).toBe('false');
      }).pend(pendingReason);

      it('a write is rejected', async () => {
        expect(await canWriteObject('us-east-1', credentials)).toBe('false');
      }).pend(pendingReason);
    });
  });

  describe('with third-party/invalid credentials', () => {
    const thirdPartyCredentials = JSON.stringify({
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      sessionToken: 'FAKETOKENdfkjaf9rufjfdklajf',
      expiration: '2019-02-26 00:08:18+00:00'
    });

    it('the bucket contents can NOT be listed', async () => {
      expect(await canListObjects('us-east-1', thirdPartyCredentials)).toBe('false');
    });

    it('the data can NOT be downloaded', async () => {
      expect(await canGetObject('us-east-1', thirdPartyCredentials)).toBe('false');
    });

    it('a write is rejected', async () => {
      expect(await canWriteObject('us-east-1', thirdPartyCredentials)).toBe('false');
    });
  });
});

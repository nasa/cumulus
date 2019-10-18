'use strict';

const { URL } = require('url');

const { Lambda, STS } = require('aws-sdk');

const { models: { AccessToken } } = require('@cumulus/api');
const {
  aws: { s3 },
  testUtils: { randomId },
  BucketsConfig
} = require('@cumulus/common');

const {
  EarthdataLogin: { getEarthdataAccessToken },
  distributionApi: { invokeApiDistributionLambda }
} = require('@cumulus/integration-tests');

const { setDistributionApiEnvVars } = require('../../helpers/apiUtils');
const { loadConfig } = require('../../helpers/testUtils');

/**
 * Calls the s3AccessTest lambda in the given region, which returns
 * true or false based on whether test on the s3 Object passes or fails.
 *
 * @param {string} stackName - stack name
 * @param {string} region - AWS region to run test from
 * @param {string} testBucketName - bucket to test against
 * @param {string} testFileKey - test file key
 * @param {Object} credentials - object with AWS credentials keys for direct s3 access
 * @param {string} testName - test to invoke from lambda can be ['list-objects',
 *                            'get-object' or 'write-object']
 * @returns {Object} - lambda payload
 */
async function invokeTestLambda(stackName, region, testBucketName, testFileKey, credentials, testName) {
  const lambda = new Lambda({ region });

  const data = await lambda.invoke({
    FunctionName: `${stackName}-S3AccessTest`,
    Payload: JSON.stringify({
      Bucket: testBucketName,
      Key: testFileKey,
      credentials,
      testName
    })
  }).promise();

  return data.Payload;
}

async function canGetObject(stackName, region, testBucketName, testFileKey, credentials) {
  return invokeTestLambda(stackName, region, testBucketName, testFileKey, credentials, 'get-object');
}

async function canWriteObject(stackName, region, testBucketName, testFileKey, credentials) {
  return invokeTestLambda(stackName, region, testBucketName, testFileKey, credentials, 'write-object');
}

async function canListObjects(stackName, region, testBucketName, testFileKey, credentials) {
  return invokeTestLambda(stackName, region, testBucketName, testFileKey, credentials, 'list-objects');
}

xdescribe('When accessing an S3 bucket directly', () => {
  let accessToken;
  let publicBucketName;
  let protectedBucketName;
  let testFileKey;
  let accessTokensModel;
  let config;

  beforeAll(async () => {
    config = await loadConfig();
    const bucketConfig = new BucketsConfig(config.buckets);
    protectedBucketName = bucketConfig.protectedBuckets()[0].name;
    publicBucketName = bucketConfig.publicBuckets()[0].name;

    testFileKey = `${config.stackName}-s3AccessTest/test.txt`;
    process.env.stackName = config.stackName;

    process.env.AccessTokensTable = `${config.stackName}-AccessTokensTable`;
    accessTokensModel = new AccessToken();

    await Promise.all([
      s3().putObject({ Bucket: protectedBucketName, Key: testFileKey, Body: 'test' }).promise(),
      s3().putObject({ Bucket: publicBucketName, Key: testFileKey, Body: 'test' }).promise()
    ]);
    setDistributionApiEnvVars();
  });

  afterAll(async () => {
    await Promise.all([
      s3().deleteObject({ Bucket: protectedBucketName, Key: testFileKey }).promise(),
      s3().deleteObject({ Bucket: publicBucketName, Key: testFileKey }).promise(),
      accessTokensModel.delete({ accessToken })
    ]);
  });

  describe('an unauthenticated request', () => {
    it('redirects to Earthdata login for requests on /s3credentials endpoint.', async () => {
      const response = await invokeApiDistributionLambda('/s3credentials');
      const authorizeUrl = new URL(response.headers.location);
      expect(authorizeUrl.origin).toEqual(process.env.EARTHDATA_BASE_URL);
      expect(authorizeUrl.searchParams.get('state')).toEqual('/s3credentials');
      expect(authorizeUrl.pathname).toEqual('/oauth/authorize');
    });
  });

  describe('with credentials associated with an Earthdata Login ID', () => {
    let creds;
    const username = randomId('newUser');

    beforeAll(async () => {
      const accessTokenResponse = await getEarthdataAccessToken({
        redirectUri: process.env.DISTRIBUTION_REDIRECT_ENDPOINT,
        requestOrigin: process.env.DISTRIBUTION_ENDPOINT,
        userParams: { username }
      }).catch((err) => {
        console.log(err);
        throw err;
      });

      accessToken = accessTokenResponse.accessToken;

      let response;
      try {
        response = await invokeApiDistributionLambda('/s3credentials', accessToken);
        creds = JSON.parse(response.body);
      } catch (e) {
        console.log(e);
        console.log(`Distribution API response: ${JSON.stringify(response, null, 2)}`);
        throw e;
      }
    });

    it('the expected user can assume same region access', async () => {
      const {
        accessKeyId,
        secretAccessKey,
        sessionToken
      } = creds;

      const sts = new STS({ accessKeyId, secretAccessKey, sessionToken });
      const whoami = await sts.getCallerIdentity().promise();

      expect(accessKeyId).toBeDefined();
      expect(secretAccessKey).toBeDefined();
      expect(sessionToken).toBeDefined();
      expect(whoami.Arn).toMatch(new RegExp(`arn:aws:sts::\\d{12}:assumed-role/s3-same-region-access-role/${username}.*`));
      expect(whoami.UserId).toMatch(new RegExp(`.*:${username}`));
    });


    function executeTestsAgainst(testBucket) {
      describe('while in the the same region ', () => {
        it('the bucket contents can be listed', async () => {
          expect(await canListObjects('us-east-1', testBucket, creds)).toBe('true');
        });

        it('the data can be downloaded', async () => {
          expect(await canGetObject(config.stackName, 'us-east-1', testBucket, testFileKey, creds)).toBe('true');
        });

        it('a write is rejected', async () => {
          expect(await canWriteObject(config.stackName, 'us-east-1', testBucket, testFileKey, creds)).toBe('false');
        });
      });

      describe('while outside the region ', () => {
        it('the bucket contents can NOT be listed', async () => {
          expect(await canListObjects(config.stackName, 'us-west-2', testBucket, testFileKey, creds)).toBe('false');
        });

        it('the data can NOT be downloaded', async () => {
          expect(await canGetObject(config.stackName, 'us-west-2', testBucket, testFileKey, creds)).toBe('false');
        });

        it('a write is rejected', async () => {
          expect(await canWriteObject(config.stackName, 'us-west-2', testBucket, testFileKey, creds)).toBe('false');
        });
      });
    }

    describe('against protected buckets', () => {
      executeTestsAgainst(protectedBucketName);
    });

    describe('against public buckets', () => {
      executeTestsAgainst(publicBucketName);
    });

    describe('with third-party/invalid credentials', () => {
      const thirdPartyCredentials = {
        accessKeyId: randomId('accessKeyId'),
        secretAccessKey: randomId('secretAccessKey'),
        sessionToken: randomId('sessionToken'),
        expiration: '2019-02-26 00:08:18+00:00'
      };

      function executeThirdPartyTestsAgainst(testBucket) {
        it('the bucket contents can NOT be listed', async () => {
          expect(await canListObjects(config.stackName, 'us-east-1', testBucket, testFileKey, thirdPartyCredentials)).toBe('false');
        });

        it('the data can NOT be downloaded', async () => {
          expect(await canGetObject(config.stackName, 'us-east-1', testBucket, testFileKey, thirdPartyCredentials)).toBe('false');
        });

        it('a write is rejected', async () => {
          expect(await canWriteObject(config.stackName, 'us-east-1', testBucket, testFileKey, thirdPartyCredentials)).toBe('false');
        });
      }

      describe('against protected buckets', () => {
        executeThirdPartyTestsAgainst(protectedBucketName);
      });

      describe('against public buckets', () => {
        executeThirdPartyTestsAgainst(publicBucketName);
      });
    });
  });
});

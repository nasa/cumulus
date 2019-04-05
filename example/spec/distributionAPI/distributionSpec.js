'use strict';

const fs = require('fs');
const { URL } = require('url');
const got = require('got');

const { models: { AccessToken } } = require('@cumulus/api');
const { serveDistributionApi } = require('@cumulus/api/bin/serve');
const {
  BucketsConfig,
  testUtils: { randomId }
} = require('@cumulus/common');
const { generateChecksumFromStream } = require('@cumulus/checksum');
const {
  distributionApi: {
    invokeApiDistributionLambda
  },
  EarthdataLogin: { getEarthdataAccessToken }
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  createTestDataPath,
  createTimestampedTestId,
  uploadTestDataToBucket,
  deleteFolder
} = require('../helpers/testUtils');
const { setDistributionApiEnvVars } = require('../helpers/apiUtils');

const config = loadConfig();

const bucketsConfig = new BucketsConfig(config.buckets);
const protectedBucketName = bucketsConfig.protectedBuckets()[0].name;
const privateBucketName = bucketsConfig.privateBuckets()[0].name;
const publicBucketName = bucketsConfig.publicBuckets()[0].name;

const s3Data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met'
];

process.env.stackName = config.stackName;


async function apiDistributionLocation(filepath, accessToken){
  const payload = await invokeApiDistributionLambda(filepath, accessToken);
  return payload.headers.location;
}

/**
 * Login with Earthdata and get response for redirect back to
 * distribution API.
 */
async function getTestAccessToken() {
  const accessTokenResponse = await getEarthdataAccessToken({
    redirectUri: process.env.DISTRIBUTION_REDIRECT_ENDPOINT,
    requestOrigin: process.env.DISTRIBUTION_ENDPOINT
  });
  return accessTokenResponse.accessToken;
}


describe('Distribution API', () => {
  const testId = createTimestampedTestId(config.stackName, 'DistributionAPITest');
  const testDataFolder = createTestDataPath(testId);
  const fileKey = `${testDataFolder}/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met`;

  process.env.AccessTokensTable = `${config.stackName}-AccessTokensTable`;
  const accessTokensModel = new AccessToken();

  beforeAll(async () => {
    await Promise.all([
      uploadTestDataToBucket(protectedBucketName, s3Data, testDataFolder),
      uploadTestDataToBucket(privateBucketName, s3Data, testDataFolder),
      uploadTestDataToBucket(publicBucketName, s3Data, testDataFolder)
    ]);
    setDistributionApiEnvVars();

  });

  afterAll(async () => {
    await Promise.all([
      deleteFolder(protectedBucketName, testDataFolder),
      deleteFolder(privateBucketName, testDataFolder),
      deleteFolder(publicBucketName, testDataFolder)
    ]);
  });

  describe('handles requests for files over HTTPS', () => {
    let fileChecksum;
    let protectedFilePath;
    let privateFilePath;
    let publicFilePath;
    let validAccessToken;
    let invalidAccessToken = randomId('accessToken');


    beforeAll(async () => {
      validAccessToken = await getTestAccessToken();
      fileChecksum = await generateChecksumFromStream(
        'cksum',
        fs.createReadStream(require.resolve(s3Data[0]))
      );
      publicFilePath = `/${publicBucketName}/${fileKey}`;
      protectedFilePath = `/${protectedBucketName}/${fileKey}`;
      privateFilePath = `/${privateBucketName}/${fileKey}`;
    });

    afterAll(async () => {
      await accessTokensModel.delete({ accessToken: validAccessToken });
    });

    describe('an unauthorized user', () => {

      it('redirects to Earthdata login for unauthorized requests for protected files', async () => {
        const response = await apiDistributionLocation(protectedFilePath);
        const authorizeUrl = new URL(response);
        expect(authorizeUrl.origin).toEqual(process.env.EARTHDATA_BASE_URL);
        expect(authorizeUrl.searchParams.get('state')).toEqual(`/${protectedBucketName}/${fileKey}`);
        expect(authorizeUrl.pathname).toEqual('/oauth/authorize');
      });

      it('redirects to Earthdata login for requests on /s3credentials endpoint.', async () => {
        const response = await apiDistributionLocation('/s3credentials');
        const authorizeUrl = new URL(response);
        expect(authorizeUrl.origin).toEqual(process.env.EARTHDATA_BASE_URL);
        expect(authorizeUrl.searchParams.get('state')).toEqual('/s3credentials');
        expect(authorizeUrl.pathname).toEqual('/oauth/authorize');
      });

      it('downloads a public science file', async () => {
        const s3SignedUrl = await apiDistributionLocation(publicFilePath);
        const parts = new URL(s3SignedUrl);
        const userName = parts.searchParams.get('x-EarthdataLoginUsername');

        const fileStream = got.stream(s3SignedUrl);
        const downloadChecksum = await generateChecksumFromStream('cksum', fileStream);
        expect(userName).toEqual('unauthenticated user');
        expect(downloadChecksum).toEqual(fileChecksum);
      });
    });

    describe('an authorized user', () => {
      it('downloads the protected science file for authorized requests', async () => {
        const s3SignedUrl = await apiDistributionLocation(protectedFilePath, validAccessToken);
        const fileStream = got.stream(s3SignedUrl);
        const downloadChecksum = await generateChecksumFromStream('cksum', fileStream);
        expect(downloadChecksum).toEqual(fileChecksum);
      });

      it('downloads a public science file', async () => {
        const s3SignedUrl = await apiDistributionLocation(publicFilePath, validAccessToken);
        const parts = new URL(s3SignedUrl);
        const userName = parts.searchParams.get('x-EarthdataLoginUsername');

        const fileStream = got.stream(s3SignedUrl);
        const downloadChecksum = await generateChecksumFromStream('cksum', fileStream);
        expect(userName).toEqual('unauthenticated user');
        expect(downloadChecksum).toEqual(fileChecksum);
      });

      it('refuses downloads of files in private buckets as forbidden', async () => {
        const signedUrl = await apiDistributionLocation(privateFilePath, validAccessToken);
        try {
          await got(signedUrl);
          fail('Expected an error to be thrown');
        }
        catch (error) {
          expect(error.statusCode).toEqual(403);
          expect(error.message).toMatch(/Forbidden/);
        }
      });
    });
  });
});

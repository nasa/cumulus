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
    getDistributionApiFileStream,
    getDistributionFileUrl,
    invokeLambdaForS3SignedUrl
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
const {
  setDistributionApiEnvVars,
  stopDistributionApi
} = require('../helpers/apiUtils');

const config = loadConfig();
const bucketsConfig = new BucketsConfig(config.buckets);
const protectedBucketName = bucketsConfig.protectedBuckets()[0].name;
const privateBucketName = bucketsConfig.privateBuckets()[0].name;
const publicBucketName = bucketsConfig.publicBuckets()[0].name;

const protectedS3Data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met'
];

const privateS3Data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met'
];

const publicS3Data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met'
];

process.env.stackName = config.stackName;

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

  let server;

  process.env.AccessTokensTable = `${config.stackName}-AccessTokensTable`;
  const accessTokensModel = new AccessToken();

  beforeAll(async (done) => {
    await Promise.all([
      uploadTestDataToBucket(protectedBucketName, protectedS3Data, testDataFolder),
      uploadTestDataToBucket(privateBucketName, privateS3Data, testDataFolder),
      uploadTestDataToBucket(publicBucketName, publicS3Data, testDataFolder)
    ]);
    setDistributionApiEnvVars();

    // Use done() callback to signal end of beforeAll() after the
    // distribution API has started up.
    server = await serveDistributionApi(config.stackName, done);
  });

  afterAll(async (done) => {
    try {
      await Promise.all([
        deleteFolder(protectedBucketName, testDataFolder),
        deleteFolder(privateBucketName, testDataFolder),
        deleteFolder(publicBucketName, testDataFolder)
      ]);
      stopDistributionApi(server, done);
    }
    catch (err) {
      stopDistributionApi(server, done);
    }
  });

  describe('handles requests for files over HTTPS', () => {
    let fileChecksum;
    let fileUrl;
    let privateFileUrl;
    let publicFileUrl;
    let accessToken;

    beforeAll(async () => {
      fileUrl = getDistributionFileUrl({
        bucket: protectedBucketName,
        key: fileKey
      });
      fileChecksum = await generateChecksumFromStream(
        'cksum',
        fs.createReadStream(require.resolve(protectedS3Data[0]))
      );
      privateFileUrl = getDistributionFileUrl({
        bucket: privateBucketName, key: fileKey
      });
      publicFileUrl = getDistributionFileUrl({
        bucket: publicBucketName, key: fileKey
      });

    });

    afterAll(async () => {
      await accessTokensModel.delete({ accessToken });
    });

    it('redirects to Earthdata login for unauthorized requests', async () => {
      const response = await got(
        fileUrl,
        { followRedirect: false }
      );
      const authorizeUrl = new URL(response.headers.location);
      expect(authorizeUrl.origin).toEqual(process.env.EARTHDATA_BASE_URL);
      expect(authorizeUrl.searchParams.get('state')).toEqual(`/${protectedBucketName}/${fileKey}`);
      expect(authorizeUrl.pathname).toEqual('/oauth/authorize');
    });

    it('redirecting to Earthdata login for unauthorized requests to /s3credentials endpoint.', async () => {
      const response = await got(
        `${process.env.DISTRIBUTION_ENDPOINT}/s3credentials`,
        { followRedirect: false }
      );
      const authorizeUrl = new URL(response.headers.location);
      expect(authorizeUrl.origin).toEqual(process.env.EARTHDATA_BASE_URL);
      expect(authorizeUrl.searchParams.get('state')).toEqual('/s3credentials');
      expect(authorizeUrl.pathname).toEqual('/oauth/authorize');
    });

    it('downloads the protected science file for authorized requests', async () => {
      accessToken = await getTestAccessToken();
      const s3SignedUrl = await invokeLambdaForS3SignedUrl(fileUrl, accessToken);
      const fileStream = got.stream(s3SignedUrl);
      const downloadChecksum = await generateChecksumFromStream('cksum', fileStream);
      expect(downloadChecksum).toEqual(fileChecksum);
    });

    it('downloads a public science file for unauthenticated requests', async () => {
      accessToken = randomId('accessToken');
      const s3SignedUrl = await invokeLambdaForS3SignedUrl(publicFileUrl, accessToken);
      const parts = new URL(s3SignedUrl);
      const userName = parts.searchParams.get('x-EarthdataLoginUsername');

      const fileStream = got.stream(s3SignedUrl);
      const downloadChecksum = await generateChecksumFromStream('cksum', fileStream);
      expect(userName).toEqual('publicAccess');
      expect(downloadChecksum).toEqual(fileChecksum);
    });

    it('refuses downloads of files in private buckets for authorized requests', async () => {
      accessToken = await getTestAccessToken();
      const signedUrl = await invokeLambdaForS3SignedUrl(privateFileUrl, accessToken);
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

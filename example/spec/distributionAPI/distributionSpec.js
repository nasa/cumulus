'use strict';

const fs = require('fs');
const { URL } = require('url');
const got = require('got');

const { models: { AccessToken } } = require('@cumulus/api');
const { BucketsConfig } = require('@cumulus/common');
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
process.env.stackName = config.stackName;
const s3Data = ['@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met'];

/**
 * Invoke the ApiDistributionLambda and return the headers location
 * @param {filepath} filepath - request.path parameter
 * @param {string} accessToken - authenticiation cookie (can be undefined).
 */
async function getDistributionApiRedirect(filepath, accessToken) {
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

  beforeAll(async (done) => {
    Promise.all(
      uploadTestDataToBucket(config.bucket, s3Data, testDataFolder),
      uploadTestDataToBucket(config.public_bucket, s3Data, testDataFolder)
    );
    setDistributionApiEnvVars();
  });

  afterAll(async (done) => {
    try {
      Promise.all(
        deleteFolder(config.bucket, testDataFolder),
        deleteFolder(config.public_bucket, testDataFolder)
      );
      stopDistributionApi(server, done);
    }
    catch (err) {
      stopDistributionApi(server, done);
    }
  });

  describe('handles requests for files over HTTPS', () => {
    let fileChecksum;
    let fileUrl;
    let publicFileUrl;
    let accessToken;

    beforeAll(async () => {
      fileUrl = getDistributionFileUrl({
        bucket: config.bucket,
        key: fileKey
      });
      publicFileUrl = getDistributionFileUrl({
        bucket: config.public_bucket,
        key: fileKey
      });

      fileChecksum = await generateChecksumFromStream(
        'cksum',
        fs.createReadStream(require.resolve(s3Data[0]))
      );
      publicFilePath = `/${publicBucketName}/${fileKey}`;
      protectedFilePath = `/${protectedBucketName}/${fileKey}`;
      privateFilePath = `/${privateBucketName}/${fileKey}`;
    });

    afterAll(async () => {
      await accessTokensModel.delete({ accessToken });
    });

    it('allows unauthorized access to public documents', async () => {
      const fileStream = await got.stream(publicFileUrl);
      const downloadChecksum = await generateChecksumFromStream('cksum', fileStream);
      expect(downloadChecksum).toEqual(fileChecksum);
    });

    it('redirects to Earthdata login for unauthorized requests', async () => {
      const response = await got(
        fileUrl,
        { followRedirect: false }
      );
      const authorizeUrl = new URL(response.headers.location);
      expect(authorizeUrl.origin).toEqual(process.env.EARTHDATA_BASE_URL);
      expect(authorizeUrl.searchParams.get('state')).toEqual(`/${config.bucket}/${fileKey}`);
      expect(authorizeUrl.pathname).toEqual('/oauth/authorize');
    });

      it('downloads a public science file', async () => {
        const s3SignedUrl = await getDistributionApiRedirect(publicFilePath);
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
        const s3SignedUrl = await getDistributionApiRedirect(protectedFilePath, accessToken);
        const fileStream = got.stream(s3SignedUrl);
        const downloadChecksum = await generateChecksumFromStream('cksum', fileStream);
        expect(downloadChecksum).toEqual(fileChecksum);
      });

      it('downloads a public science file', async () => {
        const s3SignedUrl = await getDistributionApiRedirect(publicFilePath, accessToken);
        const parts = new URL(s3SignedUrl);
        const userName = parts.searchParams.get('x-EarthdataLoginUsername');

        const fileStream = got.stream(s3SignedUrl);
        const downloadChecksum = await generateChecksumFromStream('cksum', fileStream);
        expect(userName).toEqual('unauthenticated user');
        expect(downloadChecksum).toEqual(fileChecksum);
      });

      it('refuses downloads of files in private buckets as forbidden', async () => {
        const signedUrl = await getDistributionApiRedirect(privateFilePath, accessToken);
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

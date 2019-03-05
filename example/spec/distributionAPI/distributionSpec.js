'use strict';

const fs = require('fs');
const { URL } = require('url');
const got = require('got');

const { models: { AccessToken } } = require('@cumulus/api');
const { serveDistributionApi } = require('@cumulus/api/bin/serve');
const {
  file: { getFileChecksumFromStream }
} = require('@cumulus/common');
const {
  distributionApi: { getDistributionApiFileStream, getDistributionFileUrl },
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
const s3Data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met'
];

describe('Distribution API', () => {
  const testId = createTimestampedTestId(config.stackName, 'DistributionAPITest');
  const testDataFolder = createTestDataPath(testId);
  const fileKey = `${testDataFolder}/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met`;

  let server;

  process.env.AccessTokensTable = `${config.stackName}-AccessTokensTable`;
  const accessTokensModel = new AccessToken();

  beforeAll(async (done) => {
    await uploadTestDataToBucket(config.bucket, s3Data, testDataFolder);

    setDistributionApiEnvVars();

    // Use done() callback to signal end of beforeAll() after the
    // distribution API has started up.
    server = await serveDistributionApi(config.stackName, done);
  });

  afterAll(async (done) => {
    try {
      await deleteFolder(config.bucket, testDataFolder);
      stopDistributionApi(server, done);
    }
    catch (err) {
      stopDistributionApi(server, done);
    }
  });

  describe('handles requests for files over HTTPS', () => {
    let fileChecksum;
    let fileUrl;
    let accessToken;

    beforeAll(async () => {
      fileUrl = getDistributionFileUrl({
        bucket: config.bucket,
        key: fileKey
      });
      fileChecksum = await getFileChecksumFromStream(
        fs.createReadStream(require.resolve(s3Data[0]))
      );
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
      expect(authorizeUrl.pathname).toEqual('/oauth/authorize');
    });

    it('downloads the requested science file for authorized requests', async () => {
      // Login with Earthdata and get response for redirect back to
      // distribution API.
      const accessTokenResponse = await getEarthdataAccessToken({
        redirectUri: process.env.DISTRIBUTION_REDIRECT_ENDPOINT,
        requestOrigin: process.env.DISTRIBUTION_ENDPOINT
      });
      accessToken = accessTokenResponse.accessToken;

      // Compare checksum of downloaded file with expected checksum.
      const fileStream = await getDistributionApiFileStream(fileUrl, accessToken);
      const downloadChecksum = await getFileChecksumFromStream(fileStream);
      expect(downloadChecksum).toEqual(fileChecksum);
    });
  });
});

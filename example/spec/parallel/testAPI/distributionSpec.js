'use strict';

const fs = require('fs');
const { URL } = require('url');
const got = require('got');

const { distributionApp } = require('@cumulus/api/app/distribution');
const { prepareDistributionApi } = require('@cumulus/api/bin/serve');
const {
  file: { getFileChecksumFromStream },
  testUtils: { inTestMode }
} = require('@cumulus/common');
const {
  EarthdataLogin: { getEarthdataLoginRedirectResponse }
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  createTestDataPath,
  createTimestampedTestId,
  uploadTestDataToBucket,
  deleteFolder
} = require('../../helpers/testUtils');

const config = loadConfig();
const s3Data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met'
];

describe('Distribution API', () => {
  const testId = createTimestampedTestId(config.stackName, 'DistributionAPITest');
  const testDataFolder = createTestDataPath(testId);
  const fileKey = `${testDataFolder}/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met`;
  const fileRequestPath = `${config.bucket}/${fileKey}`;
  const distributionApiPort = 5002;

  let server;

  process.env.PORT = distributionApiPort;
  process.env.DISTRIBUTION_REDIRECT_ENDPOINT = `http://localhost:${process.env.PORT}/redirect`;
  process.env.DISTRIBUTION_ENDPOINT = `http://localhost:${process.env.PORT}`;
  // Ensure integration tests use Earthdata login UAT if not specified.
  if (!process.env.EARTHDATA_BASE_URL) {
    process.env.EARTHDATA_BASE_URL = 'https://uat.urs.earthdata.nasa.gov';
  }

  beforeAll(async (done) => {
    await uploadTestDataToBucket(config.bucket, s3Data, testDataFolder);

    await prepareDistributionApi();

    // If running the tests against localstack, point to the localstack resources.
    // This must happen after prepareDistributionApi(), which sets the process.env
    // values pointing to localstack.
    if (inTestMode()) {
      config.bucket = process.env.system_bucket;
      config.stackName = process.env.stackName;
    }

    // Set env var to be used as the name for the access tokens table. Must happen
    // at this point in case the config.stackName was changed to use localstack.
    process.env.AccessTokensTable = `${config.stackName}-AccessTokensTable`;

    // Use done() callback to signal end of beforeAll() after the
    // distribution API has started up.
    server = distributionApp.listen(process.env.PORT, done);
  });

  afterAll(async (done) => {
    await deleteFolder(config.bucket, testDataFolder);
    // Use done() callback to signal end of afterAll() after the
    // distribution API has shutdown.
    server.close(done);
  });

  describe('handles requests for files over HTTPS', () => {
    let fileChecksum;

    beforeAll(async () => {
      fileChecksum = await getFileChecksumFromStream(
        fs.createReadStream(require.resolve(s3Data[0]))
      );
    });

    it('redirects to Earthdata login for unauthorized requests', async () => {
      const response = await got(
        `${process.env.DISTRIBUTION_ENDPOINT}/${fileRequestPath}`,
        { followRedirect: false }
      );
      const authorizeUrl = new URL(response.headers.location);
      expect(authorizeUrl.origin).toEqual(process.env.EARTHDATA_BASE_URL);
      expect(authorizeUrl.pathname).toEqual('/oauth/authorize');
    });

    it('downloads the requested science file for authorized requests', async () => {
      // Login with Earthdata and get response for redirect back to
      // distribution API.
      const response = await getEarthdataLoginRedirectResponse({
        redirectUri: process.env.DISTRIBUTION_REDIRECT_ENDPOINT,
        requestOrigin: process.env.DISTRIBUTION_ENDPOINT,
        state: fileRequestPath
      });

      const { 'set-cookie': cookie, location: fileUrl } = response.headers;

      // Get S3 signed URL fromm distribution API with cookie set.
      const fileResponse = await got(fileUrl, { headers: { cookie }, followRedirect: false });
      const signedS3Url = fileResponse.headers.location;

      // Compare checksum of downloaded file with expected checksum.
      const downloadChecksum = await getFileChecksumFromStream(got.stream(signedS3Url));
      expect(downloadChecksum).toEqual(fileChecksum);
    });
  });
});

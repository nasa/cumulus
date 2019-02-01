'use strict';

const fs = require('fs');
const { URL } = require('url');
const got = require('got');

const { distributionApp } = require('@cumulus/api/app/distribution');
const { prepareDistributionApi } = require('@cumulus/api/bin/serve');
const { inTestMode } = require('@cumulus/common/test-utils');
const {
  EarthdataLogin: { handleEarthdataLogin }
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
  const fileStats = fs.statSync(require.resolve(s3Data[0]));

  let server;

  beforeAll(async (done) => {
    process.env.PORT = 5002;
    process.env.EARTHDATA_BASE_URL = 'https://uat.urs.earthdata.nasa.gov';
    process.env.DEPLOYMENT_ENDPOINT = `http://localhost:${process.env.PORT}/redirect`;
    process.env.DISTRIBUTION_URL = `http://localhost:${process.env.PORT}`;

    await prepareDistributionApi();

    // Point to localstack bucket
    if (inTestMode()) {
      config.bucket = process.env.system_bucket;
    }

    await uploadTestDataToBucket(config.bucket, s3Data, testDataFolder);

    server = distributionApp.listen(process.env.PORT, done);
  });

  afterAll(async (done) => {
    await deleteFolder(config.bucket, testDataFolder);
    server.close(done);
  });

  describe('handles requests for files over HTTPS', () => {
    let authorizeUrl;

    beforeAll(async () => {
      authorizeUrl =
        await got(`${process.env.DISTRIBUTION_URL}/${config.bucket}/${fileKey}`, { followRedirect: false })
          .then((res) => new URL(res.headers.location));
    });

    it('redirects to Earthdata login for unauthorized requests', async () => {
      expect(authorizeUrl.origin).toEqual(process.env.EARTHDATA_BASE_URL);
    });

    it('downloads the requested science file for authorized requests', async (done) => {
      // Login with Earthdata and intercept the redirect URL.
      const redirectUrl = await handleEarthdataLogin(authorizeUrl.href, process.env.DISTRIBUTION_URL)
        .then((res) => res.headers.location);

      // Make request to redirect URL to exchange Earthdata authorization code
      // for access token. Retrieve access token, which is set as a cookie.
      const response = await got(redirectUrl, { followRedirect: false });
      const { 'set-cookie': cookie, location: fileUrl } = response.headers;

      // Get S3 signed URL fromm distribution API with cookie set.
      const signedS3Url = await got(fileUrl, { headers: { cookie }, followRedirect: false })
        .then((res) => res.headers.location);

      let fileContent = '';
      await got.stream(signedS3Url)
        .on('data', (chunk) => {
          fileContent += chunk;
        })
        .on('error', () => { done() })
        .on('end', () => {
          expect(fileContent.length).toEqual(fileStats.size);
          done();
        });
    });
  });
});

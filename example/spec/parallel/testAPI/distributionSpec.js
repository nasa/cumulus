'use strict';

const fs = require('fs');
const { URL } = require('url');
const supertest = require('supertest');
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
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
];

describe('Distribution API', () => {
  const testId = createTimestampedTestId(config.stackName, 'DistributionAPITest');
  const testDataFolder = createTestDataPath(testId);
  const fileKey = `${testDataFolder}/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met`;
  const fileStats = fs.statSync(require.resolve(s3Data[0]));

  let server;
  let request;

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
    request = supertest.agent(server);
  });

  afterAll(async (done) => {
    await deleteFolder(config.bucket, testDataFolder);
    server.close(done);
  });

  it('redirects to Earthdata login for unauthorized requests', async () => {
    let authorizeUrl = await request
      .get(`/${config.bucket}/${fileKey}`)
      .set('Accept', 'application/json')
      .redirects(0)
      .then((res) => new URL(res.headers.location));
    expect(authorizeUrl.origin).toEqual(process.env.EARTHDATA_BASE_URL);
  });

  it('downloads the requested science file for authorized requests', async (done) => {
    const authorizeUrl = await request
      .get(`/${config.bucket}/${fileKey}`)
      .set('Accept', 'application/json')
      .redirects(0)
      .then((res) => res.headers.location);

    // Login with Earthdata and intercept the redirect URL.
    const redirectUrl = await handleEarthdataLogin(authorizeUrl, process.env.DISTRIBUTION_URL)
      .then((res) => res.headers.location);

    // Make request to redirect URL to exchange Earthdata authorization code
    // for access token. Retrieve access token, which is set as a cookie.
    const response = await got(redirectUrl, { followRedirect: false });
    const { ['set-cookie']: cookie, location: fileUrl } = response.headers;

    // Request file from distribution API with cookie set.
    let fileContent = '';
    await got.stream(fileUrl, { headers: { cookie } })
      .on('data', (chunk) => {
        fileContent += chunk;
      })
      .on('end', () => {
        expect(fileContent.length).toEqual(fileStats.size);
        done();
      });
  });
});

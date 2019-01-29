'use strict';

const fs = require('fs');
const { URL } = require('url');
const supertest = require('supertest');
const got = require('got');

const { distributionApp } = require('@cumulus/api/app/distribution');
const { prepareDistributionApi } = require('@cumulus/api/bin/serve');
const {
  EarthdataLogin: { handleEarthdataLoginAndRedirect }
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

  process.env.PORT = 5002;
  process.env.EARTHDATA_BASE_URL = 'https://uat.urs.earthdata.nasa.gov';
  process.env.DEPLOYMENT_ENDPOINT = `http://localhost:${process.env.PORT}/redirect`;
  process.env.DISTRIBUTION_URL = `http://localhost:${process.env.PORT}`;

  beforeAll(async (done) => {
    await prepareDistributionApi();

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

    const response = await handleEarthdataLoginAndRedirect(authorizeUrl, process.env.DISTRIBUTION_URL);
    const { ['set-cookie']: cookie, location: fileUrl } = response.headers;

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

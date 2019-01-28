'use strict';

// const path = require('path');
const { URL } = require('url');
const base64 = require('base-64')
const supertest = require('supertest');
const got = require('got');

const {
  aws: { s3ObjectExists }
} = require('@cumulus/common');
const { distributionApp } = require('@cumulus/api/app/distribution');
const { prepareDistributionApi } = require('@cumulus/api/bin/serve');

const {
  loadConfig,
  createTestDataPath,
  createTimestampedTestId,
  uploadTestDataToBucket,
  deleteFolder
} = require('../../helpers/testUtils');
const config = loadConfig();

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
];

describe('Distribution API', () => {
  const testId = createTimestampedTestId(config.stackName, 'DistributionAPI');
  const testDataFolder = createTestDataPath(testId);
  const fileKey = `${testDataFolder}/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met`;

  let server;
  let request;

  beforeAll(async (done) => {
    process.env.PORT = 5002;
    await prepareDistributionApi();

    await uploadTestDataToBucket(config.bucket, s3data, testDataFolder);

    server = distributionApp.listen(process.env.PORT, done);
    request = supertest.agent(server);
  });

  afterAll(async (done) => {
    await deleteFolder(config.bucket, testDataFolder);
    server.close(done);
  });

  it('file is created', async () => {
    const fileExists = await s3ObjectExists({
      Bucket: config.bucket,
      Key: fileKey
    });
    expect(fileExists).toEqual(true);
  });

  it('returns a redirect to an OAuth2 provider', async () => {
    const authorizeUrl = await request
      .get(`/${config.bucket}/${fileKey}`)
      .set('Accept', 'application/json')
      .redirects(0)
      .then((res) => res.headers.location);

    const auth = base64.encode(process.env.EARTHDATA_USERNAME + ':' + process.env.EARTHDATA_PASSWORD);

    var requestOptions = {
      method: 'POST',
      form: true,
      body: { credentials: auth },
      headers: {
        origin: 'http://localhost:5002'
      },
      followRedirect: false
    }

    const redirectUrl = await got.post(authorizeUrl, requestOptions)
      .then((res) => res.headers.location);

    // let cookie;
    // await got(redirectUrl, { followRedirect: false })
    //   .catch((err) => {
    //     console.log(err);
    //   })
    //   .then((res) => {
    //     cookie = res.headers['set-cookie'];
    //     return res.headers.location;
    //   });

    const redirect = new URL(redirectUrl);

    let cookie;
    const fileUrl = await request
      .get(`${redirect.pathname}`)
      .query({ code: redirect.searchParams.get('code' )})
      .query({ state: redirect.searchParams.get('state' )})
      .redirects(0)
      .then((res) => {
        cookie = res.headers['set-cookie'];
        return res.headers.location;
      });

    const fileContent = await got(fileUrl, { headers: { cookie } })
      .catch((err) => {
        console.log(err);
      })
      .then((res) => {
        console.log(res.body);
        return res.body;
      });
  });

  xit('An authenticated request for a file returns a redirect to S3', async () => {
    const response = await request
      .get(`/${config.bucket}/${fileKey}`)
      .set('Accept', 'application/json')
      .set('Cookie', [`accessToken=${accessTokenRecord.accessToken}`])
      .expect(307);

    expect(response.status).toEqual(307);

    const redirectLocation = new URL(response.headers.location);
    expect(redirectLocation.origin).toEqual(signedFileUrl.origin);
    expect(redirectLocation.pathname).toEqual(signedFileUrl.pathname);
    // t.is(redirectLocation.searchParams.get('x-EarthdataLoginUsername'), accessTokenRecord.username);
  });
});

'use strict';

const path = require('path');
const { URL } = require('url');
const base64 = require('base-64')
const supertest = require('supertest');
const got = require('got');

const {
  aws: { s3, s3ObjectExists, deleteS3Object },
  testUtils: {
    randomString
  }
} = require('@cumulus/common');
// const EarthdataLoginClient = require('@cumulus/api/lib/EarthdataLogin');
// const { fakeAccessTokenFactory } = require('@cumulus/api/lib/testUtils');
// const { AccessToken } = require('@cumulus/api/models');
const { distributionApp } = require('@cumulus/api/app/distribution');
// const { app } = require('@cumulus/api/app');
const { prepareDistributionApi } = require('@cumulus/api/bin/serve');

const {
  loadConfig,
  createTestDataPath,
  createTimestampedTestId,
  createTestSuffix
} = require('../../helpers/testUtils');
const config = loadConfig();

describe('Distribution API', () => {
  const testId = createTimestampedTestId(config.stackName, 'DistributionAPI');
  const testDataFolder = createTestDataPath(testId);
  const testSuffix = createTestSuffix(testId);

  const fileLocation = path.join(testDataFolder, `DistributionAPI${testSuffix}`);
  // const authorizationUrl = `https://${randomString()}.com/${randomString()}`;
  // const accessTokenRecord = fakeAccessTokenFactory();
  const signedFileUrl = new URL(`https://${randomString()}.com/${randomString()}`);

  let server;
  let request;

  beforeAll(async (done) => {
    process.env.PORT = 5002;
    await prepareDistributionApi();

    const params = {
      Bucket: config.bucket,
      Key: fileLocation,
      Body: randomString()
    };
    await s3().putObject(params).promise();

    server = distributionApp.listen(process.env.PORT, done);
    request = supertest.agent(server);

    // const accessTokenModel = new AccessToken();
    // await accessTokenModel.create(accessTokenRecord);
  });

  beforeEach(() => {
    // spyOn(EarthdataLoginClient.prototype, 'getAccessToken').and.returnValue(accessTokenRecord);
    // spyOn(EarthdataLoginClient.prototype, 'getAuthorizationUrl').and.returnValue(authorizationUrl);
    // spyOn(s3(), 'getSignedUrl').and.callFake(() => {
    //   return signedFileUrl.toString()
    // });
  })

  afterAll(async (done) => {
    await deleteS3Object(config.bucket, fileLocation);
    server.close(done);
  });

  xit('file is created', async () => {
    const fileExists = await s3ObjectExists({
      Bucket: config.bucket,
      Key: fileLocation
    });
    expect(fileExists).toEqual(true);
  });

  it('returns a redirect to an OAuth2 provider', async () => {
    const authorizeUrl = await request
      .get(`/${fileLocation}`)
      .set('Accept', 'application/json')
      .redirects(0)
      .then((res) => res.headers.location);

    console.log(authorizeUrl);

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

    console.log(redirectUrl);

    // await got(redirectUrl)
    //   .catch((err) => {
    //     console.log(err);
    //   })
    //   .then((res) => {
    //     console.log(res.body);
    //   });

    const redirect = new URL(redirectUrl);

    await request
      .get(`${redirect.origin}${redirect.pathname}`)
      .query(redirect.searchParams)
      .on('error', (err) => {
        console.log(err);
      })
      .then((res) => {
        console.log(res.body);
      });
  });

  xit('An authenticated request for a file returns a redirect to S3', async () => {
    const response = await request
      .get(`/${config.bucket}/${fileLocation}`)
      .set('Accept', 'application/json')
      .set('Cookie', [`accessToken=${accessTokenRecord.accessToken}`])
      .expect(307);

    // expect(AWS.S3.getSignedUrl.calls.any()).toEqual(true);
    expect(response.status).toEqual(307);

    const redirectLocation = new URL(response.headers.location);
    expect(redirectLocation.origin).toEqual(signedFileUrl.origin);
    expect(redirectLocation.pathname).toEqual(signedFileUrl.pathname);
    // t.is(redirectLocation.searchParams.get('x-EarthdataLoginUsername'), accessTokenRecord.username);
  });
});

'use strict';

const AWS = require('aws-sdk');
const path = require('path');
const { URL } = require('url');
const supertest = require('supertest');

const {
  aws: { s3, s3ObjectExists, deleteS3Object },
  testUtils: {
    randomString
  }
} = require('@cumulus/common');
const EarthdataLoginClient = require('@cumulus/api/lib/EarthdataLogin');
const { fakeAccessTokenFactory } = require('@cumulus/api/lib/testUtils');
const { AccessToken } = require('@cumulus/api/models');
const { distributionApp } = require('@cumulus/api/app/distribution');
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
  const authorizationUrl = `https://${randomString()}.com/${randomString()}`;
  const accessTokenRecord = fakeAccessTokenFactory();
  const signedFileUrl = new URL(`https://${randomString()}.com/${randomString()}`);

  let server;
  let request;

  beforeAll(async (done) => {
    const params = {
      Bucket: config.bucket,
      Key: fileLocation,
      Body: randomString()
    };
    await s3().putObject(params).promise();

    process.env.PORT = 5002;
    await prepareDistributionApi();
    server = distributionApp.listen(process.env.PORT, done);
    request = supertest.agent(server);

    const accessTokenModel = new AccessToken();
    await accessTokenModel.create(accessTokenRecord);
  });

  beforeEach(() => {
    spyOn(EarthdataLoginClient.prototype, 'getAccessToken').and.returnValue(accessTokenRecord);
    spyOn(EarthdataLoginClient.prototype, 'getAuthorizationUrl').and.returnValue(authorizationUrl);
    spyOn(s3(), 'getSignedUrl').and.callFake(() => {
      console.log('HERE');
      return signedFileUrl.toString()
    });
  })

  afterAll(async (done) => {
    await deleteS3Object(config.bucket, fileLocation);
    server.close(done);
  });

  it('file is created', async () => {
    const fileExists = await s3ObjectExists({
      Bucket: config.bucket,
      Key: fileLocation
    });
    expect(fileExists).toEqual(true);
  });

  it(
    'returns a redirect to an OAuth2 provider',
    () => request
      .get(`/${fileLocation}`)
      .set('Accept', 'application/json')
      .expect(307)
  );

  it('An authenticated request for a file returns a redirect to S3', async () => {
    const response = await request
      .get(`/${config.bucket}/${fileLocation}`)
      .set('Accept', 'application/json')
      .set('Cookie', [`accessToken=${accessTokenRecord.accessToken}`])
      .expect(307);

    expect(s3().getSignedUrl.calls.any()).toEqual(true);
    expect(response.status).toEqual(307);

    const redirectLocation = new URL(response.headers.location);
    expect(redirectLocation.origin).toEqual(signedFileUrl.origin);
    expect(redirectLocation.pathname).toEqual(signedFileUrl.pathname);
    // t.is(redirectLocation.searchParams.get('x-EarthdataLoginUsername'), accessTokenRecord.username);
  });
});

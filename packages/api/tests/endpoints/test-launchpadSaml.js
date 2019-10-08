'use strict';

const fs = require('fs');
const test = require('ava');
const sinon = require('sinon');
const rewire = require('rewire');
const request = require('supertest');
const { URL } = require('url');
const saml2 = require('saml2-js');

const aws = require('@cumulus/common/aws');
const { randomId } = require('@cumulus/common/test-utils');

const { verifyJwtToken } = require('../../lib/token');
const { AccessToken, User } = require('../../models');
const launchpadSaml = rewire('../../endpoints/launchpadSaml');
const launchpadPublicCertificate = launchpadSaml.__get__(
  'launchpadPublicCertificate'
);
const buildLaunchpadJwt = launchpadSaml.__get__('buildLaunchpadJwt');

process.env.OAUTH_PROVIDER = 'launchpad';
process.env.UsersTable = randomId('usersTable');
process.env.AccessTokensTable = randomId('tokenTable');
process.env.stackName = randomId('stackname');
process.env.TOKEN_SECRET = randomId('token_secret');
process.env.system_bucket = randomId('systembucket');

const { app } = require('../../app');

const testBucketName = randomId('testbucket');
const createBucket = (Bucket) => aws.s3().createBucket({ Bucket }).promise();
const testBucketNames = [process.env.system_bucket, testBucketName];
process.env.LAUNCHPAD_METADATA_PATH = `s3://${testBucketName}/valid-metadata.xml`;

const xmlMetadataFixture = fs.readFileSync(
  `${__dirname}/fixtures/launchpad-sbx-metadata.xml`,
  'utf8'
);
const badMetadataFixture = fs.readFileSync(
  `${__dirname}/fixtures/bad-metadata.xml`,
  'utf8'
);
const goodMetadataFile = {
  key: 'valid-metadata.xml',
  content: xmlMetadataFixture
};
const badMetadataFile = {
  key: 'bad-metadata.xml',
  content: badMetadataFixture
};
const testFiles = [goodMetadataFile, badMetadataFile];

const certificate = require('./fixtures/_certificateFixture');

let accessTokenModel;
let userModel;
test.before(async () => {
  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();
  userModel = new User();
  await userModel.createTable();

  await Promise.all(testBucketNames.map(createBucket));
  await Promise.all(
    testFiles.map((f) =>
      aws.s3PutObject({
        Bucket: testBucketName,
        Key: f.key,
        Body: f.content
      }))
  );
});

let sandbox;
test.beforeEach(async (t) => {
  sandbox = sinon.createSandbox();
  const successfulSamlResponse = {
    user: {
      name_id: randomId('name_id'),
      session_index: randomId('session_index')
    }
  };
  const badSamlResponse = { user: {} };
  t.context = { successfulSamlResponse, badSamlResponse };
});

test.afterEach(async () => {
  sandbox.restore();
});

test.after.always(async () => {
  await Promise.all(testBucketNames.map(aws.recursivelyDeleteS3Bucket));
  await accessTokenModel.deleteTable();
  await userModel.deleteTable();
});

test.serial(
  'launchpadPublicCertificate returns a certificate from valid file.',
  async (t) => {
    const parsedCertificate = await launchpadPublicCertificate(
      `s3://${testBucketName}/valid-metadata.xml`
    );

    t.deepEqual(parsedCertificate, certificate);
  }
);

test.serial(
  'launchpadPublicCertificate throws error with invalid file.',
  async (t) => {
    await t.throwsAsync(
      launchpadPublicCertificate(`s3://${testBucketName}/bad-metadata.xml`),
      {
        instanceOf: Error,
        message: `Failed to retrieve Launchpad metadata X509 Certificate from s3://${testBucketName}/bad-metadata.xml`
      }
    );
  }
);

test.serial(
  'launchpadPublicCertificate throws error with missing metadata file.',
  async (t) => {
    await t.throwsAsync(
      launchpadPublicCertificate(`s3://${testBucketName}/location`),
      {
        instanceOf: Error,
        message: `Cumulus could not find Launchpad public xml metadata at s3://${testBucketName}/location`
      }
    );
  }
);

test.serial(
  'launchpadPublicCertificate throws error with missing bucket.',
  async (t) => {
    await t.throwsAsync(launchpadPublicCertificate('s3://badBucket/location'), {
      instanceOf: Error,
      message: 'Cumulus could not find Launchpad public xml metadata at s3://badBucket/location'
    });
  }
);

test('buildLaunchpadJwt returns a valid JWT with correct SAML information.', async (t) => {
  const jwt = await buildLaunchpadJwt(t.context.successfulSamlResponse);
  const decodedToken = verifyJwtToken(jwt);

  t.is(decodedToken.username, t.context.successfulSamlResponse.user.name_id);
  t.is(decodedToken.accessToken, t.context.successfulSamlResponse.user.session_index);

  const modelToken = await accessTokenModel.get({
    accessToken: t.context.successfulSamlResponse.user.session_index
  });
  t.is(modelToken.accessToken, t.context.successfulSamlResponse.user.session_index);
  t.is(modelToken.username, t.context.successfulSamlResponse.user.name_id);
});

test('buildLaunchpadJwt throws with bad SAML information.', async (t) => {
  await t.throwsAsync(buildLaunchpadJwt(t.context.badSamlResponse), {
    instanceOf: Error,
    message: 'invalid SAML response received {"user":{}}'
  });
});

test.serial('/saml/auth with bad metadata returns Bad Request.', async (t) => {
  const callback = sandbox.fake.yields('post_assert callsback with Error', null);
  const mockExample = sandbox.stub();
  mockExample.ServiceProvider = sandbox.stub().returns({ post_assert: callback });
  sandbox.replace(saml2, 'ServiceProvider', mockExample.ServiceProvider);

  const redirect = await request(app)
    .post('/saml/auth')
    .send({ SAMLResponse: '' })
    .set('Accept', 'application/json')
    .expect(400);

  t.is(redirect.body.error, 'Bad Request');
});

test.serial('/saml/auth with good metadata returns redirect.', async (t) => {
  const callback = sandbox.fake.yields(null, t.context.successfulSamlResponse);
  const mockExample = sandbox.stub();
  mockExample.ServiceProvider = sandbox.stub().returns({ post_assert: callback });
  sandbox.replace(saml2, 'ServiceProvider', mockExample.ServiceProvider);

  const redirect = await request(app)
    .post('/saml/auth')
    .send({ SAMLResponse: 'mocked inside test', RelayState: 'https://example.com' })
    .set('Accept', 'application/json')
    .expect(302);

  const redirectUrl = new URL(redirect.header.location);
  const jwt = redirectUrl.searchParams.get('token');
  const decodedToken = verifyJwtToken(jwt);
  t.is(decodedToken.username, t.context.successfulSamlResponse.user.name_id);
  t.is(decodedToken.accessToken, t.context.successfulSamlResponse.user.session_index);
});


test.serial('/token endpoint with a token query parameter returns the parameter.', async (t) => {
  const returnedToken = await request(app)
    .get('/token?token=SomeRandomJWToken')
    .set('x-apigateway-event', encodeURIComponent(JSON.stringify({ requestContext: { path: '/irrelevant/', stage: 'anything' } })))
    .set('x-apigateway-context', encodeURIComponent(JSON.stringify({})))
    .set('Accept', 'application/json')
    .expect(200);

  t.is(returnedToken.text, JSON.stringify({ message: { token: 'SomeRandomJWToken' } }));
});

test.serial('/token endpoint without a token query parameter redirects to saml/login.', async (t) => {
  const redirect = await request(app)
    .get('/token')
    .set('x-apigateway-event', encodeURIComponent(JSON.stringify({ requestContext: { path: '/token', stage: 'stagename' } })))
    .set('x-apigateway-context', encodeURIComponent(JSON.stringify({})))
    .set('Accept', 'application/json')
    .expect(302);

  t.regex(redirect.header.location, /\/stagename\/saml\/login\?RelayState=.*%2Ftoken/);
});

test.serial('/token endpoint without proper context headers returns expectation failed.', async (t) => {
  const expectedError = {
    error: 'Expectation Failed',
    message: 'Could not retrieve necessary information from express request object.',
    statusCode: 417
  };

  const badHeaders = await request(app)
    .get('/token')
    .set('x-apigateway-event', encodeURIComponent(JSON.stringify({ requestContext: {} })))
    .set('x-apigateway-context', encodeURIComponent(JSON.stringify({})))
    .set('Accept', 'application/json')
    .expect(417);

  t.deepEqual(expectedError, JSON.parse(badHeaders.error.text));
});

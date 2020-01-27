'use strict';

const fs = require('fs');
const got = require('got');
const test = require('ava').serial;
const sinon = require('sinon');
const rewire = require('rewire');
const request = require('supertest');
const { URL } = require('url');
const saml2 = require('saml2-js');

const awsServices = require('@cumulus/aws-client/services');
const {
  parseS3Uri,
  recursivelyDeleteS3Bucket,
  s3PutObject
} = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');

const { verifyJwtToken } = require('../../lib/token');
const { AccessToken } = require('../../models');
const launchpadSaml = rewire('../../endpoints/launchpadSaml');
const launchpadPublicCertificate = launchpadSaml.__get__(
  'launchpadPublicCertificate'
);
const authorizedUserGroup = launchpadSaml.__get__('authorizedUserGroup');
const buildLaunchpadJwt = launchpadSaml.__get__('buildLaunchpadJwt');

process.env.OAUTH_PROVIDER = 'launchpad';
process.env.AccessTokensTable = randomId('tokenTable');
process.env.stackName = randomId('stackname');
process.env.TOKEN_SECRET = randomId('token_secret');
process.env.system_bucket = randomId('systembucket');
process.env.LAUNCHPAD_METADATA_URL = 'http://example.com/launchpad.idp.xml';

const { app } = require('../../app');

const testBucketName = randomId('testbucket');
const createBucket = (Bucket) => awsServices.s3().createBucket({ Bucket }).promise();
const testBucketNames = [process.env.system_bucket, testBucketName];
const launchpadMetadataS3Uri = launchpadSaml.__get__('launchpadMetadataS3Uri');

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

const gotLaunchpadMetadataResponse = {
  statusCode: 200,
  statusMessage: 'OK',
  body: xmlMetadataFixture
};

let accessTokenModel;
test.before(async () => {
  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  await Promise.all(testBucketNames.map(createBucket));
  await Promise.all(
    testFiles.map((f) =>
      s3PutObject({
        Bucket: testBucketName,
        Key: f.key,
        Body: f.content
      }))
  );

  const { Bucket, Key } = parseS3Uri(launchpadMetadataS3Uri());
  await s3PutObject({
    Bucket,
    Key,
    Body: xmlMetadataFixture
  });
});

let sandbox;
test.beforeEach(async (t) => {
  sandbox = sinon.createSandbox();
  const validIndex = randomId('session_index');
  const validUser = randomId('userId');
  const unauthorizedIndex = randomId('session_index');
  const unauthorizedUser = randomId('userId');
  const userGroup = randomId('userGroup');
  process.env.oauth_user_group = userGroup;

  const successfulSamlResponse = {
    user: {
      name_id: 'junk-dont-use-this-any-more',
      session_index: validIndex,
      attributes: {
        UserId: [validUser],
        userGroup: [
          `cn=${userGroup},ou=254886,ou=ROLES,ou=Groups,dc=nasa,dc=gov^cn=AM-Application-Administrator,ou=ICAM,ou=Groups,dc=nasa,dc=gov`
        ]
      }
    }
  };

  const unauthorizedSamlResponse = {
    user: {
      session_index: unauthorizedIndex,
      attributes: {
        UserId: [unauthorizedUser],
        userGroup: [
          'cn=WrongUserGroup,ou=254886,ou=ROLES,ou=Groups,dc=nasa,dc=gov'
        ]
      }
    }
  };

  const badSamlResponse = { user: {} };

  t.context = {
    validIndex,
    validUser,
    unauthorizedIndex,
    unauthorizedUser,
    successfulSamlResponse,
    unauthorizedSamlResponse,
    badSamlResponse,
    userGroup
  };
});

test.afterEach(async () => {
  sandbox.restore();
});

test.after.always(async () => {
  await Promise.all(testBucketNames.map(recursivelyDeleteS3Bucket));
  await accessTokenModel.deleteTable();
});

test(
  'launchpadPublicCertificate returns a certificate from valid file.',
  async (t) => {
    const parsedCertificate = await launchpadPublicCertificate(
      `s3://${testBucketName}/valid-metadata.xml`
    );

    t.deepEqual(parsedCertificate, certificate);
  }
);

test(
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

test(
  'launchpadPublicCertificate downloads the metadata file to s3 when metadata is missing.',
  async (t) => {
    const stub = sinon.stub(got, 'get').callsFake(() => gotLaunchpadMetadataResponse);
    const parsedCertificate = await launchpadPublicCertificate(`s3://${testBucketName}/location`);
    t.deepEqual(parsedCertificate, certificate);
    stub.restore();
  }
);

test(
  'launchpadPublicCertificate throws error with missing bucket.',
  async (t) => {
    const stub = sinon.stub(got, 'get').callsFake(() => gotLaunchpadMetadataResponse);
    await t.throwsAsync(launchpadPublicCertificate('s3://badBucket/location'), {
      instanceOf: Error,
      message: 'Cumulus could not find Launchpad public xml metadata at s3://badBucket/location'
    });
    stub.restore();
  }
);

test(
  'authorizedUserGroup returns true if samlUserGroup contains authorized group',
  (t) => {
    const samlUserGroup = 'cn=GSFC-Cumulus-Dev,ou=254886,ou=ROLES,ou=Groups,dc=nasa,dc=gov';
    const authorizedGroup = 'GSFC-Cumulus-Dev';

    t.true(authorizedUserGroup(samlUserGroup, authorizedGroup));
  }
);

test(
  'authorizedUserGroup returns false if samlUserGroup does not contain authorized group',
  (t) => {
    const samlUserGroup = 'cn=wrongUserGroup,ou=254886,ou=ROLES,ou=Groups,dc=nasa,dc=gov';
    const authorizedGroup = 'GSFC-Cumulus-Dev';

    t.false(authorizedUserGroup(samlUserGroup, authorizedGroup));
  }
);

test(
  'authorizedUserGroup returns false if authorizeGroup undefined (unconfigured)',
  (t) => {
    const samlUserGroup = 'cn=wrongUserGroup,ou=254886,ou=ROLES,ou=Groups,dc=nasa,dc=gov';
    t.false(authorizedUserGroup(samlUserGroup));
  }
);

test('buildLaunchpadJwt returns a valid JWT with correct SAML information.', async (t) => {
  const jwt = await buildLaunchpadJwt(t.context.successfulSamlResponse);
  const decodedToken = verifyJwtToken(jwt);

  t.is(decodedToken.username, t.context.validUser);
  t.is(decodedToken.accessToken, t.context.validIndex);

  const modelToken = await accessTokenModel.get({
    accessToken: t.context.validIndex
  });
  t.is(modelToken.accessToken, t.context.validIndex);
  t.is(modelToken.username, t.context.validUser);
});

test('buildLaunchpadJwt throws with bad SAML return value.', async (t) => {
  await t.throwsAsync(buildLaunchpadJwt(t.context.badSamlResponse), {
    instanceOf: Error,
    message: 'invalid SAML response received {"user":{}}'
  });
});

test('buildLaunchpadJwt throws with unauthorized user.', async (t) => {
  await t.throwsAsync(buildLaunchpadJwt(t.context.unauthorizedSamlResponse), {
    instanceOf: Error,
    message: `User not authorized for this application ${t.context.unauthorizedUser} not a member of userGroup: ${t.context.userGroup}`
  });
});


test('/saml/auth with bad metadata returns Bad Request.', async (t) => {
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

test('/saml/auth with good metadata returns redirect.', async (t) => {
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
  t.is(decodedToken.username, t.context.validUser);
  t.is(decodedToken.accessToken, t.context.validIndex);
});


test('/token endpoint with a token query parameter returns the parameter.', async (t) => {
  const returnedToken = await request(app)
    .get('/token?token=SomeRandomJWToken')
    .set('x-apigateway-event', encodeURIComponent(JSON.stringify({ requestContext: { path: '/irrelevant/', stage: 'anything' } })))
    .set('x-apigateway-context', encodeURIComponent(JSON.stringify({})))
    .set('Accept', 'application/json')
    .expect(200);

  t.is(returnedToken.text, JSON.stringify({ message: { token: 'SomeRandomJWToken' } }));
});

test('/token endpoint without a token query parameter redirects to saml/login.', async (t) => {
  const redirect = await request(app)
    .get('/token')
    .set('x-apigateway-event', encodeURIComponent(JSON.stringify({ requestContext: { path: '/token', stage: 'stagename' } })))
    .set('x-apigateway-context', encodeURIComponent(JSON.stringify({})))
    .set('Accept', 'application/json')
    .expect(302);

  t.regex(redirect.header.location, /\/stagename\/saml\/login\?RelayState=.*%2Ftoken/);
});

test('/token endpoint without proper context headers returns expectation failed.', async (t) => {
  const expectedError = {
    error: 'Expectation Failed',
    message: ('Could not retrieve necessary information from express request object. '
              + 'Incorrect relayState or stageName information in express request.'),
    statusCode: 417
  };

  const badHeaders = await request(app)
    .get('/token')
    .set('x-apigateway-event', encodeURIComponent(JSON.stringify({ requestContext: { path: 'apath' } })))
    .set('x-apigateway-context', encodeURIComponent(JSON.stringify({})))
    .set('Accept', 'application/json')
    .expect(417);

  t.deepEqual(expectedError, JSON.parse(badHeaders.error.text));
});

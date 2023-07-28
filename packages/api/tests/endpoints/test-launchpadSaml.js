'use strict';

const fs = require('fs');
const got = require('got');
const test = require('ava');
const sinon = require('sinon');
const rewire = require('rewire');
const request = require('supertest');
const { URL } = require('url');
const saml2 = require('saml2-js');

const awsServices = require('@cumulus/aws-client/services');
const {
  parseS3Uri,
  recursivelyDeleteS3Bucket,
  s3PutObject,
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
process.env.system_bucket = randomId('bucket');
process.env.LAUNCHPAD_METADATA_URL = 'http://example.com/launchpad.idp.xml';

const { app } = require('../../app');

const testBucketName = randomId('testbucket');
const createBucket = (Bucket) => awsServices.s3().createBucket({ Bucket });
const testBucketNames = [process.env.system_bucket, testBucketName];
const launchpadMetadataS3Uri = launchpadSaml.__get__('launchpadMetadataS3Uri');

const xmlMetadataFixture = fs.readFileSync(
  `${__dirname}/fixtures/launchpad-sbx-metadata.xml`,
  'utf8'
);
const xmlMetadataFixtureV2 = fs.readFileSync(
  `${__dirname}/fixtures/launchpad-prod-metadata.xml`,
  'utf8'
);
const badMetadataFixture = fs.readFileSync(
  `${__dirname}/fixtures/bad-metadata.xml`,
  'utf8'
);
const goodMetadataFile = {
  key: 'valid-metadata.xml',
  content: xmlMetadataFixture,
};
const goodMetadataFileV2 = {
  key: 'valid-metadataV2.xml',
  content: xmlMetadataFixtureV2,
};
const badMetadataFile = {
  key: 'bad-metadata.xml',
  content: badMetadataFixture,
};
const testFiles = [goodMetadataFile, goodMetadataFileV2, badMetadataFile];

const certificate = require('./fixtures/_certificateFixture');

const gotLaunchpadMetadataResponse = {
  statusCode: 200,
  statusMessage: 'OK',
  body: xmlMetadataFixture,
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
        Body: f.content,
      }))
  );

  const { Bucket, Key } = parseS3Uri(launchpadMetadataS3Uri());
  await s3PutObject({
    Bucket,
    Key,
    Body: xmlMetadataFixture,
  });
});

let sandbox;
test.beforeEach((t) => {
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
          `cn=${userGroup},ou=254886,ou=ROLES,ou=Groups,dc=nasa,dc=gov^cn=AM-Application-Administrator,ou=ICAM,ou=Groups,dc=nasa,dc=gov`,
        ],
      },
    },
  };

  const unauthorizedSamlResponse = {
    user: {
      session_index: unauthorizedIndex,
      attributes: {
        UserId: [unauthorizedUser],
        userGroup: [
          'cn=WrongUserGroup,ou=254886,ou=ROLES,ou=Groups,dc=nasa,dc=gov',
        ],
      },
    },
  };

  const badSamlResponse = { user: {} };

  t.context = {
    ...t.context,
    validIndex,
    validUser,
    unauthorizedIndex,
    unauthorizedUser,
    successfulSamlResponse,
    unauthorizedSamlResponse,
    badSamlResponse,
    userGroup,
  };
});

test.afterEach(() => {
  sandbox.restore();
});

test.after.always(async () => {
  await Promise.all(testBucketNames.map(recursivelyDeleteS3Bucket));
  await accessTokenModel.deleteTable();
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
  'launchpadPublicCertificate returns a certificate from valid file with different namespace prefix.',
  async (t) => {
    const parsedCertificate = await launchpadPublicCertificate(
      `s3://${testBucketName}/valid-metadataV2.xml`
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
        message: `Failed to retrieve Launchpad metadata X509 Certificate from s3://${testBucketName}/bad-metadata.xml`,
      }
    );
  }
);

test.serial(
  'launchpadPublicCertificate downloads the metadata file to s3 when metadata is missing.',
  async (t) => {
    const stub = sinon.stub(got, 'get').callsFake(() => gotLaunchpadMetadataResponse);
    const parsedCertificate = await launchpadPublicCertificate(`s3://${testBucketName}/location`);
    t.deepEqual(parsedCertificate, certificate);
    stub.restore();
  }
);

test.serial(
  'launchpadPublicCertificate throws error with missing bucket.',
  async (t) => {
    const stub = sinon.stub(got, 'get').callsFake(() => gotLaunchpadMetadataResponse);
    await t.throwsAsync(launchpadPublicCertificate('s3://bad-bucket/location'), {
      instanceOf: Error,
      message: 'Cumulus could not find Launchpad public xml metadata at s3://bad-bucket/location',
    });
    stub.restore();
  }
);

test.serial(
  'authorizedUserGroup returns true if samlUserGroup contains authorized group',
  (t) => {
    const samlUserGroup = 'cn=GSFC-Cumulus-Dev,ou=254886,ou=ROLES,ou=Groups,dc=nasa,dc=gov';
    const authorizedGroup = 'GSFC-Cumulus-Dev';

    t.true(authorizedUserGroup(samlUserGroup, authorizedGroup));
  }
);

test.serial(
  'authorizedUserGroup returns false if samlUserGroup does not contain authorized group',
  (t) => {
    const samlUserGroup = 'cn=wrongUserGroup,ou=254886,ou=ROLES,ou=Groups,dc=nasa,dc=gov';
    const authorizedGroup = 'GSFC-Cumulus-Dev';

    t.false(authorizedUserGroup(samlUserGroup, authorizedGroup));
  }
);

test.serial(
  'authorizedUserGroup returns false if authorizeGroup undefined (unconfigured)',
  (t) => {
    const samlUserGroup = 'cn=wrongUserGroup,ou=254886,ou=ROLES,ou=Groups,dc=nasa,dc=gov';
    t.false(authorizedUserGroup(samlUserGroup));
  }
);

test.serial('buildLaunchpadJwt returns a valid JWT with correct SAML information.', async (t) => {
  const jwt = await buildLaunchpadJwt(t.context.successfulSamlResponse);
  const decodedToken = verifyJwtToken(jwt);

  t.is(decodedToken.username, t.context.validUser);
  t.is(decodedToken.accessToken, t.context.validIndex);

  const modelToken = await accessTokenModel.get({
    accessToken: t.context.validIndex,
  });
  t.is(modelToken.accessToken, t.context.validIndex);
  t.is(modelToken.username, t.context.validUser);
});

test.serial('buildLaunchpadJwt throws with bad SAML return value.', async (t) => {
  await t.throwsAsync(buildLaunchpadJwt(t.context.badSamlResponse), {
    instanceOf: Error,
    message: 'invalid SAML response received {"user":{}}',
  });
});

test.serial('buildLaunchpadJwt throws with unauthorized user.', async (t) => {
  await t.throwsAsync(buildLaunchpadJwt(t.context.unauthorizedSamlResponse), {
    instanceOf: Error,
    message: `User not authorized for this application ${t.context.unauthorizedUser} not a member of userGroup: ${t.context.userGroup}`,
  });
});

test.serial('/saml/auth with bad metadata returns Bad Request.', async (t) => {
  const callback = sandbox.fake.yields('post_assert callsback with Error', undefined);
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
  const callback = sandbox.fake.yields(undefined, t.context.successfulSamlResponse);
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

test.serial('getIncomingUrlFromRequest returns correct URL for API base URL with stage name', (t) => {
  const incomingUrl = launchpadSaml.getIncomingUrlFromRequest('http://api.com/dev/', '/fake-path');
  t.is(incomingUrl, 'http://api.com/dev/fake-path');
});

test.serial('getIncomingUrlFromRequest returns correct URL for API base URL without stage name', (t) => {
  const incomingUrl = launchpadSaml.getIncomingUrlFromRequest('http://api.com', '/fake-path');
  t.is(incomingUrl, 'http://api.com/fake-path');
});

test.serial('getIncomingUrlFromRequest returns correct URL for API base URL with port', (t) => {
  const incomingUrl = launchpadSaml.getIncomingUrlFromRequest('http://api.com:7000', '/fake-path');
  t.is(incomingUrl, 'http://api.com:7000/fake-path');
});

test.serial('/token endpoint with a token query parameter returns the parameter.', async (t) => {
  const returnedToken = await request(app)
    .get('/token?token=SomeRandomJWToken')
    .set('Accept', 'application/json')
    .expect(200);

  t.is(returnedToken.text, JSON.stringify({ message: { token: 'SomeRandomJWToken' } }));
});

test.serial('/token endpoint for API with stage name redirects to saml/login with correct RelayState', async (t) => {
  process.env.API_BASE_URL = 'http://api.com:7000/dev/';
  t.teardown(() => delete process.env.API_BASE_URL);

  const redirect = await request(app)
    .get('/token')
    .set('Accept', 'application/json')
    .expect(302);

  t.is(redirect.header.location, `http://api.com:7000/dev/saml/login?RelayState=${encodeURIComponent('http://api.com:7000/dev/token')}`);
});

test.serial('/token endpoint for API without stage name redirects to saml/login with correct RelayState', async (t) => {
  process.env.API_BASE_URL = 'http://api.com/';
  t.teardown(() => delete process.env.API_BASE_URL);

  const redirect = await request(app)
    .get('/token')
    .set('Accept', 'application/json')
    .expect(302);

  t.is(redirect.header.location, `http://api.com/saml/login?RelayState=${encodeURIComponent('http://api.com/token')}`);
});

test.serial('/token endpoint without API_BASE_URL environment variable returns 500 error', async (t) => {
  delete process.env.API_BASE_URL;
  const response = await request(app)
    .get('/token')
    .set('Accept', 'application/json')
    .query({
      RelayState: 'fake-relay-state',
    })
    .expect(500);

  t.is(response.statusCode, 500);
});

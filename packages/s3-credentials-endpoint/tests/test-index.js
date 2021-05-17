'use strict';

/* eslint-disable lodash/prefer-noop */
const { Cookie } = require('tough-cookie');
const cryptoRandomString = require('crypto-random-string');
const test = require('ava');
const sinon = require('sinon');
const request = require('supertest');
const rewire = require('rewire');
const moment = require('moment');

const awsServices = require('@cumulus/aws-client/services');
const { EarthdataLoginClient } = require('@cumulus/earthdata-login-client');

const models = require('@cumulus/api/models');
const { fakeAccessTokenFactory } = require('@cumulus/api/lib/testUtils');

const randomString = () => cryptoRandomString({ length: 6 });
const randomId = (prefix, separator = '-') =>
  [prefix, randomString()].filter((x) => x).join(separator);

process.env.EARTHDATA_CLIENT_ID = randomId('edlID');
process.env.EARTHDATA_CLIENT_PASSWORD = randomId('edlPW');
process.env.DISTRIBUTION_REDIRECT_ENDPOINT = 'http://example.com';
process.env.DISTRIBUTION_ENDPOINT = `https://${randomId('host')}/${randomId('path')}`;
process.env.AccessTokensTable = randomId('tokenTable');
process.env.TOKEN_SECRET = randomId('tokenSecret');

let accessTokenModel;
const {
  buildRoleSessionName,
  distributionApp,
  handleTokenAuthRequest,
  requestTemporaryCredentialsFromNgap,
  s3credentials,
} = require('..');

const index = rewire('../index.js');
const displayS3CredentialInstructions = index.__get__('displayS3CredentialInstructions');
const parseBucketKey = index.__get__('parseBucketKey');
const formatAllowedBucketKeys = index.__get__('formatAllowedBucketKeys');
const fetchPolicyForUser = index.__get__('fetchPolicyForUser');
const configuredForACLCredentials = index.__get__('configuredForACLCredentials');

const buildEarthdataLoginClient = () =>
  new EarthdataLoginClient({
    clientId: process.env.EARTHDATA_CLIENT_ID,
    clientPassword: process.env.EARTHDATA_CLIENT_PASSWORD,
    earthdataLoginUrl: 'https://uat.urs.earthdata.nasa.gov',
    redirectUri: process.env.DISTRIBUTION_REDIRECT_ENDPOINT,
  });

test.before(async (t) => {
  accessTokenModel = new models.AccessToken('token');
  await accessTokenModel.createTable();

  const stubbedAccessToken = fakeAccessTokenFactory();
  await accessTokenModel.create(stubbedAccessToken);

  sinon.stub(
    EarthdataLoginClient.prototype,
    'getAccessToken'
  ).callsFake(() => stubbedAccessToken);

  t.context = { stubbedAccessToken };
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  sinon.reset();
});

test('An authorized s3credential request invokes NGAPs request for credentials with username from accessToken cookie', async (t) => {
  const username = randomId('username');
  const fakeCredential = { Payload: JSON.stringify({ fake: 'credential' }) };

  const spy = sinon.spy(() => Promise.resolve(fakeCredential));
  sinon.stub(awsServices, 'lambda').callsFake(() => ({
    invoke: (params) => ({
      promise: () => spy(params),
    }),
  }));

  const accessTokenRecord = fakeAccessTokenFactory({ username });
  await accessTokenModel.create(accessTokenRecord);

  process.env.STS_CREDENTIALS_LAMBDA = 'Fake-NGAP-Credential-Dispensing-Lambda';
  const FunctionName = process.env.STS_CREDENTIALS_LAMBDA;
  const Payload = JSON.stringify({
    accesstype: 'sameregion',
    returntype: 'lowerCamel',
    duration: '3600',
    rolesession: username,
    userid: username,
  });

  await request(distributionApp)
    .get('/s3credentials')
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenRecord.accessToken}`])
    .expect(200);

  t.true(spy.called);
  t.deepEqual(spy.args[0][0], {
    FunctionName,
    Payload,
  });
});

test('An s3credential request without access Token redirects to Oauth2 provider.', async (t) => {
  const response = await request(distributionApp)
    .get('/s3credentials')
    .set('Accept', 'application/json')
    .expect(307);
  const authorizationUrl = buildEarthdataLoginClient().getAuthorizationUrl(response.req.path);

  t.is(response.status, 307);
  t.is(response.headers.location, authorizationUrl);
});

test('An s3credential request with expired accessToken redirects to Oauth2 provider', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory({
    expirationTime: moment().unix(),
  });
  await accessTokenModel.create(accessTokenRecord);

  const response = await request(distributionApp)
    .get('/s3credentials')
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenRecord.accessToken}`])
    .expect(307);
  const authorizationUrl = buildEarthdataLoginClient().getAuthorizationUrl(response.req.path);

  t.is(response.status, 307);
  t.is(response.headers.location, authorizationUrl);
});

test('A redirect request returns a response with an unexpired cookie ', async (t) => {
  const { stubbedAccessToken } = t.context;
  const response = await request(distributionApp)
    .get('/redirect')
    .query({ code: randomId('code'), state: randomId('authorizationUrl') })
    .set('Accept', 'application/json')
    .expect(307);

  const cookie = response.headers['set-cookie'].map(Cookie.parse);
  const accessToken = cookie.find((c) => c.key === 'accessToken');
  t.truthy(accessToken);
  t.is(accessToken.value, stubbedAccessToken.accessToken);
  t.is(
    accessToken.expires.valueOf(),
    stubbedAccessToken.expirationTime * 1000
  );
  t.true(accessToken.expires.valueOf() > Date.now());
});

test('buildRoleSessionName() returns the username if a client name is not provided', (t) => {
  t.is(
    buildRoleSessionName('username'),
    'username'
  );
});

test('buildRoleSessionName() returns the username and client name if a client name is provided', (t) => {
  t.is(
    buildRoleSessionName('username', 'clientname'),
    'username@clientname'
  );
});

test('requestTemporaryCredentialsFromNgap() invokes the credentials lambda with the correct payload', async (t) => {
  let invocationCount = 0;

  const lambdaFunctionName = 'my-lambda-function-name';
  const roleSessionName = 'my-role-session-name';
  const userId = 'my-user-id';

  const fakeLambda = {
    invoke: (params) => {
      invocationCount += 1;

      t.is(params.FunctionName, lambdaFunctionName);

      t.deepEqual(
        JSON.parse(params.Payload),
        {
          accesstype: 'sameregion',
          returntype: 'lowerCamel',
          duration: '3600',
          rolesession: roleSessionName,
          userid: userId,
        }
      );

      return {
        promise: () => Promise.resolve(),
      };
    },
  };

  await requestTemporaryCredentialsFromNgap({
    lambda: fakeLambda,
    lambdaFunctionName,
    userId,
    roleSessionName,
  });

  t.is(invocationCount, 1);
});

test('handleTokenAuthRequest() saves the client name in the request, if provided', async (t) => {
  const req = {
    get(headerName) {
      return this.headers[headerName];
    },
    headers: {
      'EDL-Client-Id': 'my-client-id',
      'EDL-Token': 'my-token',
      'EDL-Client-Name': 'my-client-name',
    },
    earthdataLoginClient: {
      getTokenUsername() {
        return Promise.resolve('my-username');
      },
    },
  };

  await handleTokenAuthRequest(req, undefined, () => undefined);

  t.is(req.authorizedMetadata.clientName, 'my-client-name');
});

test('handleTokenAuthRequest() with an invalid client name results in a "Bad Request" response', async (t) => {
  const req = {
    get(headerName) {
      return this.headers[headerName];
    },
    headers: {
      'EDL-Client-Id': 'my-client-id',
      'EDL-Token': 'my-token',
      'EDL-Client-Name': 'not valid',
    },
    earthdataLoginClient: {
      getTokenUsername() {
        return Promise.resolve('my-username');
      },
    },
  };

  const res = {
    boom: {
      badRequest: () => 'response-from-boom-badRequest',
    },
  };

  const next = () => t.fail('next() should not have been called');

  t.is(
    await handleTokenAuthRequest(req, res, next),
    'response-from-boom-badRequest'
  );
});

test('s3credentials() with just a username sends the correct request to the Lambda function', async (t) => {
  let lambdaInvocationCount = 0;

  const fakeLambda = {
    invoke: ({ Payload }) => {
      lambdaInvocationCount += 1;

      const parsedPayload = JSON.parse(Payload);

      t.is(parsedPayload.userid, 'my-user-name');
      t.is(parsedPayload.rolesession, 'my-user-name');

      return {
        promise: () => Promise.resolve({
          Payload: JSON.stringify({}),
        }),
      };
    },
  };

  const req = {
    authorizedMetadata: {
      userName: 'my-user-name',
    },
    lambda: fakeLambda,
  };

  const res = {
    send() {},
  };

  await s3credentials(req, res);

  t.is(lambdaInvocationCount, 1);
});

test('s3credentials() with a username and a client name sends the correct request to the Lambda function', async (t) => {
  let lambdaInvocationCount = 0;

  const fakeLambda = {
    invoke: ({ Payload }) => {
      lambdaInvocationCount += 1;

      const parsedPayload = JSON.parse(Payload);

      t.is(parsedPayload.userid, 'my-user-name');
      t.is(parsedPayload.rolesession, 'my-user-name@my-client-name');

      return {
        promise: () => Promise.resolve({
          Payload: JSON.stringify({}),
        }),
      };
    },
  };

  const req = {
    authorizedMetadata: {
      userName: 'my-user-name',
      clientName: 'my-client-name',
    },
    lambda: fakeLambda,
  };

  const res = {
    send() {},
  };

  await s3credentials(req, res);

  t.is(lambdaInvocationCount, 1);
});

test('displayS3Credentials fills template with correct distribution endpoint.', async (t) => {
  const send = sinon.spy();
  const res = { send };
  const expectedLink = `<a href="${process.env.DISTRIBUTION_ENDPOINT}s3credentials" target="_blank">${process.env.DISTRIBUTION_ENDPOINT}s3credentials</a>`;

  await displayS3CredentialInstructions(undefined, res);
  t.true(send.calledWithMatch(expectedLink));
});

test.serial('An s3credential request with DISABLE_S3_CREDENTIALS set to true results in a 503 error', async (t) => {
  process.env.DISABLE_S3_CREDENTIALS = true;
  const username = randomId('username');
  const accessTokenRecord = fakeAccessTokenFactory({ username });
  await accessTokenModel.create(accessTokenRecord);

  const response = await request(distributionApp)
    .get('/s3credentials')
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenRecord.accessToken}`])
    .expect(503);

  t.is(response.status, 503);
  t.is(response.body.message, 'S3 Credentials Endpoint has been disabled');
  t.teardown(() => {
    delete process.env.DISABLE_S3_CREDENTIALS;
  });
});

test('configuredForACLCredentials is true if environment variable is true', (t) => {
  process.env.CMR_ACL_BASED_CREDENTIALS = 'true';
  t.true(configuredForACLCredentials());
  t.teardown(() => delete process.env.CMR_ACL_BASED_CREDENTIALS);
});

test('configuredForACLCredentials is true if environment variable is TRUE', (t) => {
  process.env.CMR_ACL_BASED_CREDENTIALS = 'TRUE';
  t.true(configuredForACLCredentials());
  t.teardown(() => delete process.env.CMR_ACL_BASED_CREDENTIALS);
});

test('configuredForACLCredentials is false if environment variable is empty', (t) => {
  process.env.CMR_ACL_BASED_CREDENTIALS = '';
  t.false(configuredForACLCredentials());
  t.teardown(() => delete process.env.CMR_ACL_BASED_CREDENTIALS);
});

test('configuredForACLCredentials is false if environment variable is false', (t) => {
  process.env.CMR_ACL_BASED_CREDENTIALS = 'false';
  t.false(configuredForACLCredentials());
  t.teardown(() => delete process.env.CMR_ACL_BASED_CREDENTIALS);
});

test('configuredForACLCredentials is false if environment variable is undefined', (t) => {
  delete process.env.CMR_ACL_BASED_CREDENTIALS;
  t.false(configuredForACLCredentials());
});

test('parseBucketKey returns an array of bucket and keypath with standard input', (t) => {
  const bucketKeyPath = 'abucket/and/apath/after/it';
  const expected = { bucket: 'abucket', keypath: '/and/apath/after/it' };
  const actual = parseBucketKey(bucketKeyPath);
  t.deepEqual(expected, actual);
});

test('parseBucketKey returns an array of bucket and default keypath input is bucket only', (t) => {
  const bucketKeyPath = 'justabucket';
  const expected = { bucket: 'justabucket', keypath: '/' };
  const actual = parseBucketKey(bucketKeyPath);
  t.deepEqual(expected, actual);
});

test('parseBucketKey returns an array of undefined with bad input.', (t) => {
  const bucketKeyPath = { expecting: 'a string', not: 'an object' };
  const expected = {};
  const actual = parseBucketKey(bucketKeyPath);
  t.deepEqual(expected, actual);
});

test('allowedBucketKeys formats a list of buckets and bucket/keypaths into expected object shape.', (t) => {
  const bucketKeyList = [
    'lonebucket',
    'bucketstarpath/*',
    'bucket/deep/star/path/*',
    'bucket/withonepath',
    'bucket2/with/deep/path',
    { object: 'that is not expected' },
  ];

  // shape of object expected by NGAP's policy helper lambda
  const expected = JSON.stringify({
    accessmode: 'Allow',
    bucketlist: ['lonebucket', 'bucketstarpath', 'bucket', 'bucket', 'bucket2', undefined],
    pathlist: ['/', '/*', '/deep/star/path/*', '/withonepath', '/with/deep/path', undefined],
  });

  const actual = formatAllowedBucketKeys(bucketKeyList);
  t.is(actual, expected);
});

test.serial('fetchPolicyForUser returned undefined if endpoint not configured for ACL Credentials', async (t) => {
  process.env.CMR_ACL_BASED_CREDENTIALS = 'false';

  const expected = undefined;
  const actual = await fetchPolicyForUser('anyUser', 'anyProvider', 'anyLambda');
  t.is(expected, actual);

  t.teardown(() => delete process.env.CMR_ACL_BASED_CREDENTIALS);
});

test.serial('fetchPolicyForUser calls NGAP\'s Policy Helper lambda with the correct payload when configured for ACL credentials', async (t) => {
  const inputENV = process.env.CMR_ACL_BASED_CREDENTIALS;
  const inputStsFunction = process.env.STS_POLICY_HELPER_LAMBDA;
  const stsFunction = randomId('sts-helper-function');
  process.env.STS_POLICY_HELPER_LAMBDA = stsFunction;
  process.env.CMR_ACL_BASED_CREDENTIALS = 'true';

  const spy = sinon.spy();
  const fakeLambda = {
    invoke: (payload) => ({
      promise: () => {
        spy(payload);
        return { then: () => undefined };
      },
    }),
  };

  // set up cmr call
  const bucket1 = randomId('bucket');
  const path1 = randomId('path');
  const bucket2 = randomId('bucket2');
  const getUserAccessibleBucketFake = sinon.fake.resolves([`${bucket1}/${path1}`, bucket2]);
  const bucketRestore = index.__set__('getUserAccessibleBuckets', getUserAccessibleBucketFake);

  const edlUser = randomId('cmruser');
  const cmrProvider = randomId('cmrprovider');

  const expectedPayload = {
    FunctionName: stsFunction,
    Payload: JSON.stringify({
      accessmode: 'Allow',
      bucketlist: [bucket1, bucket2],
      pathlist: [`/${path1}`, '/'],
    }),
  };

  await fetchPolicyForUser(edlUser, cmrProvider, fakeLambda);

  t.true(getUserAccessibleBucketFake.calledWith(edlUser, cmrProvider));
  t.true(spy.calledWith(expectedPayload));

  process.env.CMR_ACL_BASED_CREDENTIALS = inputENV;
  process.env.STS_POLICY_HELPER_LAMBDA = inputStsFunction;
  bucketRestore();
});
/* eslint-enable lodash/prefer-noop */

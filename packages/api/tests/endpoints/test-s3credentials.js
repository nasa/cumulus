'use strict';

/* eslint-disable lodash/prefer-noop */
const cryptoRandomString = require('crypto-random-string');
const test = require('ava');
const sinon = require('sinon');
const rewire = require('rewire');
const randomString = () => cryptoRandomString({ length: 6 });

const randomId = (prefix, separator = '-') =>
  [prefix, randomString()].filter((x) => x).join(separator);

process.env.OAUTH_CLIENT_ID = randomId('oauthID');
process.env.OAUTH_CLIENT_PASSWORD = randomId('oauthPW');
process.env.DISTRIBUTION_REDIRECT_ENDPOINT = 'http://example.com';
process.env.DISTRIBUTION_ENDPOINT = `https://${randomId('host')}/${randomId('path')}`;
process.env.AccessTokensTable = randomId('tokenTable');
process.env.TOKEN_SECRET = randomId('tokenSecret');

const {
  s3credentials,
  buildRoleSessionName,
  requestTemporaryCredentialsFromNgap,
} = require('../../endpoints/s3credentials');
const credentialsFile = rewire('../../endpoints/s3credentials');

const parseBucketKey = credentialsFile.__get__('parseBucketKey');
const formatAllowedBucketKeys = credentialsFile.__get__('formatAllowedBucketKeys');
const fetchPolicyForUser = credentialsFile.__get__('fetchPolicyForUser');
const configuredForACLCredentials = credentialsFile.__get__('configuredForACLCredentials');

test.serial('s3credentials() with just a username sends the correct request to the Lambda function', async (t) => {
  let lambdaInvocationCount = 0;

  const fakeLambda = {
    invoke: ({ Payload }) => {
      lambdaInvocationCount += 1;

      const parsedPayload = JSON.parse(new TextDecoder('utf-8').decode(Payload));

      t.is(parsedPayload.userid, 'my-user-name');
      t.is(parsedPayload.rolesession, 'my-user-name');

      return Promise.resolve({
        Payload: new TextEncoder().encode(JSON.stringify({})),
      });
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

test.serial('s3credentials() with a username and a client name sends the correct request to the Lambda function', async (t) => {
  let lambdaInvocationCount = 0;

  const fakeLambda = {
    invoke: ({ Payload }) => {
      lambdaInvocationCount += 1;

      const parsedPayload = JSON.parse(new TextDecoder('utf-8').decode(Payload));

      t.is(parsedPayload.userid, 'my-user-name');
      t.is(parsedPayload.rolesession, 'my-user-name@my-client-name');

      return Promise.resolve({
        Payload: new TextEncoder().encode(JSON.stringify({})),
      });
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
        JSON.parse(new TextDecoder('utf-8').decode(params.Payload)),
        {
          accesstype: 'sameregion',
          returntype: 'lowerCamel',
          duration: '3600',
          rolesession: roleSessionName,
          userid: userId,
        }
      );

      return Promise.resolve();
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
  const expected = new TextEncoder().encode(JSON.stringify({
    accessmode: 'Allow',
    bucketlist: ['lonebucket', 'bucketstarpath', 'bucket', 'bucket', 'bucket2', undefined],
    pathlist: ['/', '/*', '/deep/star/path/*', '/withonepath', '/with/deep/path', undefined],
  }));

  const actual = formatAllowedBucketKeys(bucketKeyList);
  t.deepEqual(actual, expected);
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
    invoke: (payload) => {
      spy(payload);
      return { then: () => undefined };
    },
  };

  // set up cmr call
  const bucket1 = randomId('bucket');
  const path1 = randomId('path');
  const bucket2 = randomId('bucket2');
  const getUserAccessibleBucketFake = sinon.fake.resolves([`${bucket1}/${path1}`, bucket2]);
  const bucketRestore = credentialsFile.__set__('getUserAccessibleBuckets', getUserAccessibleBucketFake);

  const edlUser = randomId('cmruser');
  const cmrProvider = randomId('cmrprovider');

  const expectedPayload = {
    FunctionName: stsFunction,
    Payload: new TextEncoder().encode(JSON.stringify({
      accessmode: 'Allow',
      bucketlist: [bucket1, bucket2],
      pathlist: [`/${path1}`, '/'],
    })),
  };

  await fetchPolicyForUser(edlUser, cmrProvider, fakeLambda);

  t.true(getUserAccessibleBucketFake.calledWith(edlUser, cmrProvider));
  t.true(spy.calledWith(expectedPayload));

  process.env.CMR_ACL_BASED_CREDENTIALS = inputENV;
  process.env.STS_POLICY_HELPER_LAMBDA = inputStsFunction;
  bucketRestore();
});
/* eslint-enable lodash/prefer-noop */

'use strict';

const cryptoRandomString = require('crypto-random-string');
const test = require('ava');
const randomString = () => cryptoRandomString({ length: 6 });

const randomId = (prefix, separator = '-') =>
  [prefix, randomString()].filter((x) => x).join(separator);

process.env.EARTHDATA_CLIENT_ID = randomId('edlID');
process.env.EARTHDATA_CLIENT_PASSWORD = randomId('edlPW');
process.env.DISTRIBUTION_REDIRECT_ENDPOINT = 'http://example.com';
process.env.DISTRIBUTION_ENDPOINT = `https://${randomId('host')}/${randomId('path')}`;
process.env.AccessTokensTable = randomId('tokenTable');
process.env.TOKEN_SECRET = randomId('tokenSecret');

const {
  s3credentials,
  buildRoleSessionName,
  requestTemporaryCredentialsFromNgap,
} = require('../../endpoints/s3credentials');

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

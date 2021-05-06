'use strict';

process.env.EARTHDATA_CLIENT_ID = randomId('edlID');
process.env.EARTHDATA_CLIENT_PASSWORD = randomId('edlPW');
process.env.DISTRIBUTION_REDIRECT_ENDPOINT = 'http://example.com';
process.env.DISTRIBUTION_ENDPOINT = `https://${randomId('host')}/${randomId('path')}`;
process.env.AccessTokensTable = randomId('tokenTable');
process.env.TOKEN_SECRET = randomId('tokenSecret');

test('s3credentials() with just a username sends the correct request to the Lambda function', async (t) => {
  let lambdaInvocationCount = 0;

  const fakeLambda = {
      invoke: ({ Payload }) => {
      lambdaInvocationCount += 1;

      const parsedPayload = JSON.parse(Payload);

      t.is(parsedPayload.userid, 'my-user-name');
      t.is(parsedPayload.rolesession, 'my-user-name');

      return {
          promise: async () => ({
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
      // eslint-disable-next-line lodash/prefer-noop
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
          promise: async () => ({
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
      // eslint-disable-next-line lodash/prefer-noop
      send() {},
  };

  await s3credentials(req, res);

  t.is(lambdaInvocationCount, 1);
});

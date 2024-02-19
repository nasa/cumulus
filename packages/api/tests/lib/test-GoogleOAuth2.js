'use strict';

const test = require('ava');

const GoogleOAuth2 = require('../../lib/GoogleOAuth2');

test('The GoogleOAuth2 constructor throws a TypeError if googleOAuth2Client is not specified', (t) => {
  const err = t.throws(() => {
    new GoogleOAuth2(undefined, {});
  },
  { instanceOf: TypeError });

  t.is(err.message, 'googleOAuth2Client is required');
});

test('The GoogleOAuth2 constructor throws a TypeError if googlePlusPeopleClient is not specified', (t) => {
  const err = t.throws(() => {
    new GoogleOAuth2({}, undefined);
  },
  { instanceOf: TypeError });

  t.is(err.message, 'googlePlusPeopleClient is required');
});

test('GoogleOAuth2.getAuthorizationUrl() properly requests an authorization URL from the googleOAuth2Client', (t) => {
  const mockGoogleOAuth2Client = {
    generateAuthUrl: (params) => {
      t.is(params.access_type, 'offline');
      t.deepEqual(params.scope, ['https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile']);
      t.is(params.state, 'my-state');

      return 'http://www.example.com';
    },
  };

  const mockGooglePlusPeopleClient = {
    people: {
      get: () => Promise.resolve({
        data: {
          emailAddresses: ['fakeEmail@fake.com'],
        },
      }),
    },
  };

  const googleOAuth2 = new GoogleOAuth2(mockGoogleOAuth2Client, mockGooglePlusPeopleClient);
  googleOAuth2.getAuthorizationUrl('my-state');
});

test('GoogleOAuth2.getAuthorizationUrl() returns the correct authorization URL', (t) => {
  const mockGoogleOAuth2Client = {
    generateAuthUrl: () => 'http://www.example.com',
  };

  const mockGooglePlusPeopleClient = {
    people: {
      get: () => Promise.resolve({
        data: {
          emailAddresses: ['fakeEmail@fake.com'],
        },
      }),
    },
  };

  const googleOAuth2 = new GoogleOAuth2(mockGoogleOAuth2Client, mockGooglePlusPeopleClient);
  const authorizationUrl = googleOAuth2.getAuthorizationUrl();

  t.is(authorizationUrl, 'http://www.example.com');
});

test('GoogleOAuth2.getAccessToken() throws a TypeError if authorizationCode is not set', async (t) => {
  const mockGoogleOAuth2Client = {};

  const mockGooglePlusPeopleClient = {
    people: {
      get: () => Promise.resolve({
        data: {
          emailAddresses: [
            { value: 'fakeEmail@fake.com' },
          ],
        },
      }),
    },
  };
  const googleOAuth2 = new GoogleOAuth2(mockGoogleOAuth2Client, mockGooglePlusPeopleClient);

  try {
    await googleOAuth2.getAccessToken();
    t.fail('Expected getAccessToken to throw an error');
  } catch (error) {
    t.true(error instanceof TypeError);
    t.is(error.message, 'authorizationCode is required');
  }
});

test('GoogleOAuth2.getAccessToken() properly requests a token from the googleOAuth2Client', async (t) => {
  const getTokenResponse = {
    tokens: { access_token: 'my-access-token' },
  };

  const mockGoogleOAuth2Client = {
    getToken: (authorizationCode) => {
      t.is(authorizationCode, 'my-authorization-code');

      return getTokenResponse;
    },
    setCredentials: () => undefined,
  };

  const mockGooglePlusPeopleClient = {
    people: {
      get: () => Promise.resolve({
        data: {
          emailAddresses: [
            { value: 'sidney@example.com' },
          ],
        },
      }),
    },
  };

  const googleOAuth2 = new GoogleOAuth2(mockGoogleOAuth2Client, mockGooglePlusPeopleClient);
  await googleOAuth2.getAccessToken('my-authorization-code');
});

test('GoogleOAuth2.getAccessToken() properly sets credentials on the googleOAuth2Client', async (t) => {
  const getTokenResponse = {
    tokens: { access_token: 'my-access-token' },
  };

  const mockGoogleOAuth2Client = {
    getToken: () => Promise.resolve(getTokenResponse),

    setCredentials: (tokensParam) => {
      t.deepEqual(getTokenResponse.tokens, tokensParam);
    },
  };

  const mockGooglePlusPeopleClient = {
    people: {
      get: () => Promise.resolve({
        data: {
          emailAddresses: [
            { value: 'sidney@example.com' },
          ],
        },
      }),
    },
  };

  const googleOAuth2 = new GoogleOAuth2(mockGoogleOAuth2Client, mockGooglePlusPeopleClient);
  await googleOAuth2.getAccessToken('my-authorization-code');
});

test('GoogleOAuth2.getAccessToken() properly requests user info from the googlePlusPeopleClient', async (t) => {
  const getTokenResponse = {
    tokens: { access_token: 'my-access-token' },
  };

  const mockGoogleOAuth2Client = {
    getToken: () => Promise.resolve(getTokenResponse),
    setCredentials: () => undefined,
  };

  const mockGooglePlusPeopleClient = {
    people: {
      get: (params) => {
        t.is(params.resourceName, 'people/me');
        t.is(params.access_token, getTokenResponse.tokens.access_token);
        t.is(params.personFields, 'emailAddresses');
        return Promise.resolve({
          data: {
            emailAddresses: [
              { value: 'sidney@example.com' },
            ],
          },
        });
      },
    },
  };

  const googleOAuth2 = new GoogleOAuth2(mockGoogleOAuth2Client, mockGooglePlusPeopleClient);
  await googleOAuth2.getAccessToken('my-authorization-code');
});

test('GoogleOAuth2.getAccessToken() returns token information for a valid authorizationCode', async (t) => {
  const expiryDate = Date.now();
  const tokens = {
    access_token: 'my-access-token',
    refresh_token: 'my-refresh-token',
    expiry_date: expiryDate,
  };

  const getTokenResponse = { tokens };

  const mockGoogleOAuth2Client = {
    getToken: () => Promise.resolve(getTokenResponse),
    setCredentials: () => undefined,
  };

  const mockGooglePlusPeopleClient = {
    people: {
      get: (params) => {
        t.is(params.resourceName, 'people/me');
        t.is(params.access_token, getTokenResponse.tokens.access_token);
        t.is(params.personFields, 'emailAddresses');
        return Promise.resolve({
          data: {
            emailAddresses: [
              { value: 'sidney@example.com' },
            ],
          },
        });
      },
    },
  };

  const googleOAuth2 = new GoogleOAuth2(mockGoogleOAuth2Client, mockGooglePlusPeopleClient);

  const {
    accessToken,
    refreshToken,
    expirationTime,
    username,
  } = await googleOAuth2.getAccessToken('my-authorization-code');

  t.is(accessToken, 'my-access-token');
  t.is(refreshToken, 'my-refresh-token');
  t.is(expirationTime, Math.floor(expiryDate / 1000));
  t.is(username, 'sidney@example.com');
});

test('GoogleOAuth2.refreshAccessToken() throws "Not implemented" error', async (t) => {
  const mockGoogleOAuth2Client = {};
  const mockGooglePlusPeopleClient = {};
  const googleOAuth2 = new GoogleOAuth2(mockGoogleOAuth2Client, mockGooglePlusPeopleClient);

  try {
    await googleOAuth2.refreshAccessToken('fake-token');
    t.fail('Expected error to be thrown');
  } catch (error) {
    t.is(error.message, 'Not implemented');
  }
});

'use strict';

const test = require('ava');
const { URL } = require('url');
const {
  aws: { s3 },
  testUtils: { randomString }
} = require('@cumulus/common');

const distributionEndpoint = require('../../endpoints/distribution');
const EarthdataLoginClient = require('../../lib/EarthdataLogin');
const { OAuth2AuthenticationFailure } = require('../../lib/OAuth2');


test.beforeEach((t) => {
  t.context.clientId = randomString();
  t.context.clientPassword = randomString();
  t.context.earthdataLoginUrl = `http://${randomString()}`;
  t.context.redirectUri = `http://${randomString()}/cb`;

  t.context.earthdataLoginClient = new EarthdataLoginClient({
    clientId: t.context.clientId,
    clientPassword: t.context.clientPassword,
    earthdataLoginUrl: t.context.earthdataLoginUrl,
    redirectUri: t.context.redirectUri
  });

  t.context.s3Client = s3();
});

test('Using Earthdata Login, GET without a code in the queryParameters returns a correct redirect', async (t) => {
  const granuleId = randomString();

  const request = {
    pathParameters: {
      proxy: granuleId
    },
    queryParameters: {}
  };

  const response = await distributionEndpoint.handleRequest(
    request,
    t.context.earthdataLoginClient,
    t.context.s3Client
  );

  const locationUrl = new URL(response.headers.Location);

  t.is(response.statusCode, 302);
  t.is(response.headers['Strict-Transport-Security'], 'max-age=31536000');

  t.is(locationUrl.origin, t.context.earthdataLoginUrl);

  t.is(locationUrl.pathname, '/oauth/authorize');

  t.is(locationUrl.searchParams.get('client_id'), t.context.clientId);
  t.is(locationUrl.searchParams.get('redirect_uri'), t.context.redirectUri);
  t.is(locationUrl.searchParams.get('response_type'), 'code');
  t.is(locationUrl.searchParams.get('state'), granuleId);
});

test('Using Earthdata Login, GET without a code and with state set in pathParameters.proxy sets the correct state in the redirect URL', async (t) => {
  const state = randomString();

  const request = {
    pathParameters: {
      proxy: state
    },
    queryParameters: {}
  };

  const response = await distributionEndpoint.handleRequest(
    request,
    t.context.earthdataLoginClient,
    t.context.s3Client
  );

  const locationUrl = new URL(response.headers.Location);

  t.is(locationUrl.searchParams.get('state'), state);
});

test('Using Earthdata Login, GET without a code and with state set in queryParameters.state sets the correct state in the redirect URL', async (t) => {
  const state = randomString();

  const request = {
    queryStringParameters: {
      state
    }
  };

  const response = await distributionEndpoint.handleRequest(
    request,
    t.context.earthdataLoginClient,
    t.context.s3Client
  );

  const locationUrl = new URL(response.headers.Location);

  t.is(locationUrl.searchParams.get('state'), state);
});

test('Using Earthdata Login, GET with an invalid code returns a 400 response', async (t) => {
  const earthdataLoginClient = {
    getAccessToken: async () => {
      throw new OAuth2AuthenticationFailure();
    }
  };

  const request = {
    queryStringParameters: {
      code: randomString()
    }
  };

  const response = await distributionEndpoint.handleRequest(
    request,
    earthdataLoginClient,
    t.context.s3Client
  );

  t.is(response.statusCode, 400);
});


test("The S3 redirect includes the user's Earthdata Login username", async (t) => {
  const myUsername = randomString();

  const earthdataLoginClient = {
    getAccessToken: async () => ({
      accessToken: 'my-access-token',
      refreshToken: 'my-refresh-token',
      username: myUsername,
      expirationTime: 12345
    })
  };

  const request = {
    queryStringParameters: {
      code: randomString(),
      state: `${randomString()}/${randomString()}`
    }
  };

  const response = await distributionEndpoint.handleRequest(
    request,
    earthdataLoginClient,
    t.context.s3Client
  );

  t.is(response.statusCode, 302);

  const redirectLocation = new URL(response.headers.Location);
  t.is(redirectLocation.searchParams.get('x-EarthdataLoginUsername'), myUsername);
});

test('The correct signed URL is requested', async (t) => {
  const earthdataLoginClient = {
    getAccessToken: async () => ({
      accessToken: 'my-access-token',
      refreshToken: 'my-refresh-token',
      username: 'sidney',
      expirationTime: 12345
    })
  };

  const granuleBucket = randomString();
  const granuleKey = `${randomString()}/${randomString()}`;

  const s3Client = {
    getSignedUrl: (operation, params) => {
      t.is(params.Bucket, granuleBucket);
      t.is(params.Key, granuleKey);

      return 'http://www.example.com';
    }
  };

  const request = {
    queryStringParameters: {
      code: randomString(),
      state: `${granuleBucket}/${granuleKey}`
    }
  };

  await distributionEndpoint.handleRequest(
    request,
    earthdataLoginClient,
    s3Client
  );
});

test('A correct error is returned if the granule bucket and key could not be extracted', async (t) => {
  const earthdataLoginClient = {
    getAccessToken: async () => ({
      accessToken: 'my-access-token',
      refreshToken: 'my-refresh-token',
      username: 'my-username',
      expirationTime: 12345
    })
  };

  const request = {
    queryStringParameters: {
      code: randomString(),
      state: 'invalid'
    }
  };

  const response = await distributionEndpoint.handleRequest(
    request,
    earthdataLoginClient,
    t.context.s3Client
  );

  t.is(response.statusCode, 400);

  const parsedBody = JSON.parse(response.body);

  t.is(parsedBody.error, 'Granule location "invalid" could not be parsed');
});

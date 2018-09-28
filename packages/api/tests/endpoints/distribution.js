'use strict';

const test = require('ava');
const { URL } = require('url');
const {
  aws: { s3 },
  testUtils: { randomString }
} = require('@cumulus/common');

const distributionEndpoint = require('../../endpoints/distribution');
const EarthdataLoginClient = require('../../lib/EarthdataLoginClient');
const { ClientAuthenticationError } = require('../../lib/errors');

class TestEarthdataLoginClient extends EarthdataLoginClient {
  constructor(params) {
    const defaultParams = {
      clientId: randomString(),
      clientPassword: randomString(),
      earthdataLoginUrl: `http://${randomString()}`,
      redirectUri: `http://${randomString()}`
    };

    super(Object.assign(defaultParams, params));
  }
}

class InvalidAuthorizationCodeEarthdataLoginClient extends TestEarthdataLoginClient {
  async getAccessToken() {
    throw new ClientAuthenticationError();
  }
}

class AcceptAnyAuthorizationCodeEarthdataLoginClient extends TestEarthdataLoginClient {
  async getAccessToken() {
    return {
      accessToken: randomString(),
      username: this.username || randomString(),
      expirationTime: Date.now() + (60 * 60 * 1000)
    };
  }
}

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

test('GET without a code in the queryParameters returns a correct redirect', async (t) => {
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

test('GET without a code and with state set in pathParameters.proxy sets the correct state in the redirect URL', async (t) => {
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

test('GET without a code and with state set in queryParameters.state sets the correct state in the redirect URL', async (t) => {
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

test('GET with an invalid code returns a 400 response', async (t) => {
  const earthdataLoginClient = new InvalidAuthorizationCodeEarthdataLoginClient();

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
  const earthdataLoginClient = new AcceptAnyAuthorizationCodeEarthdataLoginClient();

  const myUsername = randomString();
  earthdataLoginClient.username = myUsername;

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
  const earthdataLoginClient = new AcceptAnyAuthorizationCodeEarthdataLoginClient();

  const granuleBucket = randomString();
  const granuleKey = `${randomString()}/${randomString()}`;

  const s3Client = {
    getSignedUrl: (operation, params) => {
      t.is(params.Bucket, granuleBucket);
      t.is(params.Key, granuleKey);

      return 'http://www.example.com';
    }
  };

  const myUsername = randomString();
  earthdataLoginClient.username = myUsername;

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

test.todo('A correct error is returned if the granule bucket and key could not be extracted');

test.todo('Handle the case where an access token is included in the request, instead of an authorization code');

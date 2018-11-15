'use strict';

const test = require('ava');
const { Cookie } = require('tough-cookie');
const { URL } = require('url');
const { randomString } = require('@cumulus/common/test-utils');

const distributionEndpoint = require('../../endpoints/distribution');
const { AccessToken } = require('../../models');
const { normalizeHeaders } = require('../../lib/api-gateway');
const { fakeAccessTokenFactory } = require('../../lib/testUtils');

function headerIs(headers, key, value) {
  const lowerCaseKey = key.toLowerCase();

  return headers[lowerCaseKey].length === 1
    && headers[lowerCaseKey][0] === value;
}

function validateDefaultHeaders(t, response) {
  const headers = normalizeHeaders(response);

  t.true(headerIs(headers, 'Access-Control-Allow-Origin', '*'));
  t.true(headerIs(headers, 'Strict-Transport-Security', 'max-age=31536000'));
}

function validateRedirectToGetAuthorizationCode(t, response) {
  const { authorizationUrl } = t.context;

  t.is(response.statusCode, 307);

  validateDefaultHeaders(t, response);

  t.is(response.headers.Location, authorizationUrl);
}

let suiteContext;

test.before(async () => {
  const accessTokenModel = new AccessToken({ tableName: randomString() });
  await accessTokenModel.createTable();

  suiteContext = {
    accessTokenModel
  };
});

test.beforeEach(async (t) => {
  const { accessTokenModel } = suiteContext;

  const accessTokenRecord = fakeAccessTokenFactory();
  await accessTokenModel.create(accessTokenRecord);

  const accessTokenCookie = new Cookie({
    key: 'accessToken',
    value: accessTokenRecord.accessToken
  });

  const fileBucket = randomString();
  const fileKey = randomString();
  const fileLocation = `${fileBucket}/${fileKey}`;

  const getAccessTokenResponse = {
    accessToken: randomString(),
    refreshToken: randomString(),
    username: randomString(),
    expirationTime: Date.now() + (60 * 60 * 1000)
  };

  const authClient = {
    getAccessToken(authorizationCode) {
      if (authorizationCode !== t.context.authorizationCode) {
        throw new Error(`Unexpected authorizationCode: ${authorizationCode}`);
      }

      return t.context.getAccessTokenResponse;
    },
    getAuthorizationUrl(state) {
      if (state !== t.context.fileLocation) {
        throw new Error(`Unexpected state: ${state}`);
      }

      return t.context.authorizationUrl;
    }
  };

  const s3Client = {
    getSignedUrl(operation, params) {
      if (operation !== 'getObject') {
        throw new Error(`Unexpected operation: ${operation}`);
      }

      if (params.Bucket !== fileBucket) {
        throw new Error(`Unexpected params.Bucket: ${params.Bucket}`);
      }

      if (params.Key !== fileKey) {
        throw new Error(`Unexpected params.Key: ${params.Key}`);
      }

      return t.context.signedFileUrl.toString();
    }
  };

  t.context = {
    accessTokenRecord,
    accessTokenCookie,
    authClient,
    getAccessTokenResponse,
    fileBucket,
    fileKey,
    fileLocation,
    s3Client,
    authorizationUrl: `https://${randomString()}.com/${randomString()}`,
    signedFileUrl: new URL(`https://${randomString()}.com/${randomString()}`),
    authorizationCode: randomString(),
    distributionUrl: `https://${randomString()}/${randomString()}`
  };
});

test.after.always(async () => {
  const { accessTokenModel } = suiteContext;

  await accessTokenModel.deleteTable();
});

test('A request for a file without an access token returns a redirect to an OAuth2 provider', async (t) => {
  const { authClient, fileLocation } = t.context;

  const request = {
    httpMethod: 'GET',
    resource: '/{proxy+}',
    pathParameters: {
      proxy: fileLocation
    }
  };

  const response = await distributionEndpoint.handleRequest({
    authClient,
    request
  });

  validateRedirectToGetAuthorizationCode(t, response);
});

test('A request for a file using a non-existent access token returns a redirect to an OAuth2 provider', async (t) => {
  const { accessTokenModel } = suiteContext;
  const { authClient, fileLocation } = t.context;

  const accessTokenCookie = new Cookie({
    key: 'accessToken',
    value: randomString()
  });

  const request = {
    httpMethod: 'GET',
    resource: '/{proxy+}',
    pathParameters: {
      proxy: fileLocation
    },
    multiValueHeaders: {
      cookie: [accessTokenCookie.toString()]
    }
  };

  const response = await distributionEndpoint.handleRequest({
    accessTokenModel,
    authClient,
    request
  });

  validateRedirectToGetAuthorizationCode(t, response);
});

test('A request for a file using an expired access token returns a redirect to an OAuth2 provider', async (t) => {
  const { accessTokenModel } = suiteContext;
  const { authClient, fileLocation } = t.context;

  const accessTokenRecord = fakeAccessTokenFactory({
    expirationTime: Date.now() - (5 * 1000)
  });
  await accessTokenModel.create(accessTokenRecord);

  const accessTokenCookie = new Cookie({
    key: 'accessToken',
    value: accessTokenRecord.accessToken
  });

  const request = {
    httpMethod: 'GET',
    resource: '/{proxy+}',
    pathParameters: {
      proxy: fileLocation
    },
    multiValueHeaders: {
      cookie: [accessTokenCookie.toString()]
    }
  };

  const response = await distributionEndpoint.handleRequest({
    accessTokenModel,
    authClient,
    request
  });

  validateRedirectToGetAuthorizationCode(t, response);
});

test('An authenticated request for a file that cannot be parsed returns a 404', async (t) => {
  const { accessTokenModel } = suiteContext;
  const { accessTokenCookie, authClient } = t.context;

  t.context.fileLocation = 'invalid';

  const request = {
    httpMethod: 'GET',
    resource: '/{proxy+}',
    pathParameters: {
      proxy: t.context.fileLocation
    },
    multiValueHeaders: {
      cookie: [accessTokenCookie.toString()]
    }
  };

  const response = await distributionEndpoint.handleRequest({
    accessTokenModel,
    authClient,
    request
  });

  t.is(response.statusCode, 404);
});

test('An authenticated request for a file returns a redirect to S3', async (t) => {
  const { accessTokenModel } = suiteContext;

  const {
    accessTokenCookie,
    accessTokenRecord,
    authClient,
    fileLocation,
    s3Client,
    signedFileUrl
  } = t.context;

  const request = {
    httpMethod: 'GET',
    resource: '/{proxy+}',
    pathParameters: {
      proxy: fileLocation
    },
    multiValueHeaders: {
      cookie: [accessTokenCookie.toString()]
    }
  };

  const response = await distributionEndpoint.handleRequest({
    accessTokenModel,
    authClient,
    request,
    s3Client
  });

  t.is(response.statusCode, 307);

  validateDefaultHeaders(t, response);

  const { location } = normalizeHeaders(response);
  const redirectLocation = new URL(location);

  t.is(redirectLocation.origin, signedFileUrl.origin);
  t.is(redirectLocation.pathname, signedFileUrl.pathname);

  t.is(redirectLocation.searchParams.get('x-EarthdataLoginUsername'), accessTokenRecord.username);
});

test('A /redirect request with a good authorization code returns a correct response', async (t) => {
  const { accessTokenModel } = suiteContext;

  const {
    authClient,
    authorizationCode,
    getAccessTokenResponse,
    distributionUrl,
    fileLocation,
    s3Client
  } = t.context;

  const request = {
    httpMethod: 'GET',
    resource: '/redirect',
    pathParameters: {},
    multiValueHeaders: {},
    queryStringParameters: {
      code: authorizationCode,
      state: fileLocation
    }
  };

  const response = await distributionEndpoint.handleRequest({
    accessTokenModel,
    authClient,
    distributionUrl,
    request,
    s3Client
  });

  t.is(response.statusCode, 307);

  validateDefaultHeaders(t, response);

  t.is(response.headers.Location, `${distributionUrl}/${fileLocation}`);

  const headers = normalizeHeaders(response);

  const setCookieHeaders = headers['set-cookie'] || [];
  const cookies = setCookieHeaders.map(Cookie.parse);
  const setAccessTokenCookie = cookies.find((c) => c.key === 'accessToken');

  t.truthy(setAccessTokenCookie);
  t.is(setAccessTokenCookie.value, getAccessTokenResponse.accessToken);
  t.is(setAccessTokenCookie.httpOnly, true);
  t.is(setAccessTokenCookie.secure, true);

  t.is(
    setAccessTokenCookie.expires.valueOf(),
    // Cookie expirations only have per-second precision
    getAccessTokenResponse.expirationTime - (getAccessTokenResponse.expirationTime % 1000)
  );
});

test('A /redirect request with a good authorization code stores the access token', async (t) => {
  const { accessTokenModel } = suiteContext;

  const {
    authClient,
    authorizationCode,
    distributionUrl,
    fileLocation,
    s3Client
  } = t.context;

  const request = {
    httpMethod: 'GET',
    resource: '/redirect',
    pathParameters: {},
    multiValueHeaders: {},
    queryStringParameters: {
      code: authorizationCode,
      state: fileLocation
    }
  };

  const response = await distributionEndpoint.handleRequest({
    accessTokenModel,
    authClient,
    distributionUrl,
    request,
    s3Client
  });

  const headers = normalizeHeaders(response);

  const setCookieHeaders = headers['set-cookie'] || [];
  const cookies = setCookieHeaders.map(Cookie.parse);
  const setAccessTokenCookie = cookies.find((c) => c.key === 'accessToken');

  t.true(await accessTokenModel.exists({ accessToken: setAccessTokenCookie.value }));
});

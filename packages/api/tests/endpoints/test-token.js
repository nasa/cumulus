'use strict';

// Load external library dependencies
const clone = require('lodash.clonedeep');
const { google } = require('googleapis');
const got = require('got');
const OAuth2 = google.auth.OAuth2;
const sinon = require('sinon');
const test = require('ava');

// Load internal library dependencies
process.env.UsersTable = 'spec-UsersTable';
const { User } = require('../../models');
// FIXME: Order matters here (and order should never matter) - we have to stub
// the google plus method before we load googleToken.
const plusStub = {
  people: {
    get: (object, cb) => {
      const userData = {
        data: {
          emails: ['peggy@gmail.com']
        }
      };
      return cb(null, userData);
    }
  }
};
sinon.stub(google, 'plus').returns(plusStub);
const tokenEndpoint = require('../../endpoints/token');

// Define test variables
const event = {
  queryStringParameters: {
    code: '007',
    state: 'https://hulu.com'
  }
};
const eventWithoutCode = { queryStringParameters: {} };
const eventWithoutState = { queryStringParameters: { code: '007' } };
const context = { succeed: (body) => body };
const callback = (err, response) => {
  if (err) throw err;
  return response;
};
const accessToken = '123';
const tokens = {
  access_token: accessToken,
  expiry_date: Date.now(),
  refresh_token: accessToken
};
const defaultHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Strict-Transport-Security': 'max-age=31536000',
  'Content-Type': 'application/json'
};

// Setup sandbox for creating and restoring stubs
let sandbox;
test.beforeEach(() => {
  sandbox = sinon.sandbox.create();
});
test.afterEach(() => sandbox.restore());

test('login returns a 301 redirect to Google when code does not exist', (t) => {
  const loginResult = tokenEndpoint.login(eventWithoutCode, {}, callback);

  const googleOauthEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth?' +
    'access_type=offline&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.email&' +
    `state=&response_type=code&client_id=${process.env.EARTHDATA_CLIENT_ID || ''}&redirect_uri=`;
  const earthDataOauthEndpoint = `${process.env.EARTHDATA_BASE_URL}` +
    `/oauth/authorize?client_id=${process.env.EARTHDATA_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.API_ENDPOINT)}&response_type=code`;

  const expectedResponseObject = {
    statusCode: '301',
    body: 'Redirecting to login',
    headers: {
      Location: process.env.OAUTH_PROVIDER === 'google' ? googleOauthEndpoint : earthDataOauthEndpoint
    }
  };

  t.deepEqual(loginResult, expectedResponseObject);
});

test('token returns an error when no code is provided', (t) => {
  const expectedResult = {
    body: JSON.stringify({ message: 'Request requires a code' }),
    headers: defaultHeaders,
    statusCode: 400
  };

  return tokenEndpoint.token(eventWithoutCode, context)
    .then((result) => {
      t.deepEqual(result, expectedResult);
    });
});

test('token returns an error when auth client returns an error', (t) => {
  const getTokenErrorMessage = 'error from getToken';
  sandbox.stub(OAuth2.prototype, 'getToken').rejects('GetTokenError', getTokenErrorMessage);
  sandbox.stub(got, 'post').rejects('GetTokenError', getTokenErrorMessage);

  //const result = tokenEndpoint.token(event, context);
  const expectedResult = {
    body: JSON.stringify({ message: getTokenErrorMessage }),
    headers: defaultHeaders,
    statusCode: 400
  };

  return tokenEndpoint.token(event, context)
    .then((result) => {
      t.deepEqual(result, expectedResult);
    });
});

test('token returns an error when no user is found', (t) => {
  sandbox.stub(OAuth2.prototype, 'getToken').resolves(tokens);
  sandbox.stub(got, 'post').resolves({ body: { ...tokens, endpoint: '/peggy' } });
  sandbox.stub(User.prototype, 'get').rejects(new Error('No record found for'));

  const expectedResult = {
    body: JSON.stringify({ message: 'User is not authorized to access this site' }),
    headers: defaultHeaders,
    statusCode: 400
  };

  return tokenEndpoint.token(event, context)
    .then((result) => {
      t.deepEqual(result, expectedResult);
    });
});

test('token returns 301 when user exists and state provided', (t) => {
  sandbox.stub(OAuth2.prototype, 'getToken').resolves(tokens);
  sandbox.stub(got, 'post').resolves({ body: { ...tokens, endpoint: '/peggy' } });
  sandbox.stub(User.prototype, 'get').resolves(true);
  sandbox.stub(User.prototype, 'update').resolves(true);

  const expectedHeaders = Object.assign(clone(defaultHeaders), {
    Location: `https://hulu.com?token=${accessToken}`,
    'Content-Type': 'text/plain'
  });
  const expectedResult = {
    statusCode: 301,
    headers: expectedHeaders,
    body: 'Redirecting to the specified state'
  };

  return tokenEndpoint.token(event, context)
    .then((result) => {
      t.deepEqual(result, expectedResult);
    });
});

test('token returns 200 when user exists and state is not provided', (t) => {
  sandbox.stub(OAuth2.prototype, 'getToken').resolves(tokens);
  sandbox.stub(got, 'post').resolves({ body: { ...tokens, endpoint: '/peggy' } });
  sandbox.stub(User.prototype, 'get').resolves(true);
  sandbox.stub(User.prototype, 'update').resolves(true);

  const expectedHeaders = Object.assign(clone(defaultHeaders), {
    'Content-Type': 'text/plain'
  });
  const expectedResult = {
    statusCode: 200,
    headers: expectedHeaders,
    body: JSON.stringify({ token: accessToken })
  };

  return tokenEndpoint.token(eventWithoutState, context)
    .then((result) => {
      t.deepEqual(result, expectedResult);
    });
});

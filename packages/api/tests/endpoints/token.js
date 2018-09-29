'use strict';

const nock = require('nock');
const test = require('ava');
const { URL } = require('url');
const {
  testUtils: {
    randomString
  }
} = require('@cumulus/common');

const { fakeUserFactory } = require('../../lib/testUtils');
const { User } = require('../../models');
const { handleRequest } = require('../../endpoints/token');

let userModel;
test.before(async () => {
  process.env.UsersTable = randomString();

  userModel = new User();
  await userModel.createTable();
});

test.beforeEach(() => {
  nock.cleanAll();
});

test.after.always(async () => {
  await userModel.deleteTable();
});

test('A request for anything other that GET /token results in a 404', async (t) => {
  const request = {
    httpMethod: 'GET',
    resource: '/invalid'
  };

  const response = await handleRequest(request);

  t.is(response.statusCode, 404);
});

test.serial('When using Earthdata Login, GET /token without a code or state query parameter results in a redirect without a state', async (t) => {
  process.env.EARTHDATA_BASE_URL = 'http://www.example.com';
  process.env.EARTHDATA_CLIENT_ID = 'client-id';
  process.env.API_ENDPOINT = 'http://www.example.com/cb';

  const request = {
    httpMethod: 'GET',
    resource: '/token'
  };

  const response = await handleRequest(request);
  const locationHeader = new URL(response.headers.Location);

  t.is(response.statusCode, 301);

  t.is(locationHeader.origin, 'http://www.example.com');
  t.is(locationHeader.pathname, '/oauth/authorize');
  t.is(locationHeader.searchParams.get('response_type'), 'code');
  t.is(locationHeader.searchParams.get('client_id'), 'client-id');
  t.is(locationHeader.searchParams.get('redirect_uri'), 'http://www.example.com/cb');
  t.false(locationHeader.searchParams.has('state'));
});

test.serial('When using Earthdata Login, GET /token without a code, but with a state, results in a redirect with that state', async (t) => {
  process.env.EARTHDATA_BASE_URL = 'http://www.example.com';
  process.env.EARTHDATA_CLIENT_ID = 'client-id';
  process.env.API_ENDPOINT = 'http://www.example.com/cb';

  const request = {
    httpMethod: 'GET',
    resource: '/token',
    queryStringParameters: {
      state: 'http://www.example.com/state'
    }
  };

  const response = await handleRequest(request);
  const locationHeader = new URL(response.headers.Location);

  t.is(response.statusCode, 301);

  t.is(locationHeader.origin, 'http://www.example.com');
  t.is(locationHeader.pathname, '/oauth/authorize');
  t.is(locationHeader.searchParams.get('response_type'), 'code');
  t.is(locationHeader.searchParams.get('client_id'), 'client-id');
  t.is(locationHeader.searchParams.get('redirect_uri'), 'http://www.example.com/cb');
  t.is(locationHeader.searchParams.get('state'), 'http://www.example.com/state');
});

test.serial('When using Earthdata Login, GET /token with an invalid code results in an authorization failure response', async (t) => {
  process.env.EARTHDATA_BASE_URL = 'http://www.example.com';
  process.env.EARTHDATA_CLIENT_ID = 'client-id';
  process.env.API_ENDPOINT = 'http://www.example.com/cb';

  const request = {
    httpMethod: 'GET',
    resource: '/token',
    queryStringParameters: {
      code: 'invalid-authorization-code'
    }
  };

  const tokenRequest = nock('http://www.example.com')
    .post('/oauth/token')
    .query(true)
    .reply(400, { error: 'invalid_grant' });

  const response = await handleRequest(request);

  t.true(tokenRequest.isDone());

  t.is(response.statusCode, 401);
  t.is(JSON.parse(response.body).message, 'Failed to get authorization token');
});

test.serial('When using Earthdata Login, GET /token with a code for an unauthorized user results in an authorization failure response', async (t) => {
  process.env.EARTHDATA_BASE_URL = 'http://www.example.com';
  process.env.EARTHDATA_CLIENT_ID = 'client-id';
  process.env.API_ENDPOINT = 'http://www.example.com/cb';

  const request = {
    httpMethod: 'GET',
    resource: '/token',
    queryStringParameters: {
      code: 'valid-authorization-code'
    }
  };

  const tokenRequest = nock('http://www.example.com')
    .post('/oauth/token')
    .query(true)
    .reply(
      200,
      {
        access_token: 'access-token',
        token_type: 'bearer',
        expires_in: 100,
        refresh_token: 'refresh-token',
        endpoint: '/api/users/eve'
      }
    );

  const response = await handleRequest(request);

  t.true(tokenRequest.isDone());

  t.is(response.statusCode, 401);
  t.is(JSON.parse(response.body).message, 'User is not authorized to access this site');
});

test.serial('When using Earthdata Login, GET /token with a code but no state returns the access token', async (t) => {
  process.env.EARTHDATA_BASE_URL = 'http://www.example.com';
  process.env.EARTHDATA_CLIENT_ID = 'client-id';
  process.env.API_ENDPOINT = 'http://www.example.com/cb';

  const userName = randomString();
  await userModel.create(fakeUserFactory({ userName }));

  const request = {
    httpMethod: 'GET',
    resource: '/token',
    queryStringParameters: {
      code: 'valid-authorization-code'
    }
  };

  const tokenRequest = nock('http://www.example.com')
    .post('/oauth/token')
    .query(true)
    .reply(
      200,
      {
        access_token: 'access-token',
        token_type: 'bearer',
        expires_in: 100,
        refresh_token: 'refresh-token',
        endpoint: `/api/users/${userName}`
      }
    );

  const response = await handleRequest(request);

  t.true(tokenRequest.isDone());

  t.is(response.statusCode, 200);

  const parsedBody = JSON.parse(response.body);
  t.is(parsedBody.message.token, 'access-token');
});

test.serial('When using Earthdata Login, GET /token with a code and state results in a redirect to that state', async (t) => {
  process.env.EARTHDATA_BASE_URL = 'http://www.example.com';
  process.env.EARTHDATA_CLIENT_ID = 'client-id';
  process.env.API_ENDPOINT = 'http://www.example.com/cb';

  const userName = randomString();
  await userModel.create(fakeUserFactory({ userName }));

  const request = {
    httpMethod: 'GET',
    resource: '/token',
    queryStringParameters: {
      code: 'valid-authorization-code',
      state: 'http://www.example.com/state'
    }
  };

  const tokenRequest = nock('http://www.example.com')
    .post('/oauth/token')
    .query(true)
    .reply(
      200,
      {
        access_token: 'access-token',
        token_type: 'bearer',
        expires_in: 100,
        refresh_token: 'refresh-token',
        endpoint: `/api/users/${userName}`
      }
    );

  const response = await handleRequest(request);
  const locationHeader = new URL(response.headers.Location);

  t.true(tokenRequest.isDone());

  t.is(response.statusCode, 301);

  t.is(locationHeader.origin, 'http://www.example.com');
  t.is(locationHeader.pathname, '/state');
  t.is(locationHeader.searchParams.get('token'), 'access-token');
});

test.serial('When using Earthdata Login, GET /token with a code updates the user in DynamoDb', async (t) => {
  process.env.EARTHDATA_BASE_URL = 'http://www.example.com';
  process.env.EARTHDATA_CLIENT_ID = 'client-id';
  process.env.API_ENDPOINT = 'http://www.example.com/cb';

  const userName = randomString();
  const userBefore = fakeUserFactory({ userName });
  await userModel.create(userBefore);

  const request = {
    httpMethod: 'GET',
    resource: '/token',
    queryStringParameters: {
      code: 'valid-authorization-code',
      state: 'http://www.example.com/state'
    }
  };

  nock('http://www.example.com')
    .post('/oauth/token')
    .query(true)
    .reply(
      200,
      {
        access_token: 'access-token',
        token_type: 'bearer',
        expires_in: 100,
        refresh_token: 'refresh-token',
        endpoint: `/api/users/${userName}`
      }
    );

  await handleRequest(request);

  const userAfter = await userModel.get({ userName });

  t.is(userAfter.refresh, 'refresh-token');
  t.is(userAfter.password, 'access-token');
});

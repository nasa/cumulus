'use strict';

const { default: test } = require('ava');
const nock = require('nock');
const { randomId } = require('@cumulus/common/test-utils');
const { getEDLToken, retrieveEDLToken, createEDLToken, revokeEDLToken } = require('../EarthdataLogin');
const { buildBasicAuthHeader, createToken, buildCreateTokenResponse, buildGetTokensResponse } = require('./EarthdataLoginUtils.js');

test.before(() => {
  nock.disableNetConnect();
});

test.beforeEach((t) => {
  t.context.username = randomId('username-');
  t.context.password = randomId('password-');

  const token = createToken();

  t.context.postResponse = buildCreateTokenResponse(token);
});

test.afterEach.always(() => {
  nock.cleanAll();
});

test.after.always(() => {
  nock.enableNetConnect();
});

test.serial('getToken returns a valid token', async (t) => {
  const { username, password } = t.context;

  const now = new Date();
  const oneHourLater = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const unexpiredToken = createToken({
    expirationTime: oneHourLater.valueOf() / 1000,
  });

  const expirationDate = oneHourLater.toLocaleDateString('en', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });

  const expectedresponse = [
    {
      access_token: unexpiredToken,
      token_type: 'Beaer',
      expiration_date: expirationDate,
    },
  ];

  nock('https://urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, expectedresponse);

  const token = await getEDLToken(username, password, 'PROD');
  t.is(token, unexpiredToken);
});

test('retrieveEDLToken returns undefined if there are no tokens', async (t) => {
  const { username, password } = t.context;

  nock('https://sit.urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, []);

  const result = await retrieveEDLToken(username, password, 'SIT');

  t.is(result, undefined);
});

test.serial('retrieveToken returns a valid token', async (t) => {
  const { username, password } = t.context;

  const now = new Date();
  const oneHourLater = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const unexpiredToken = createToken({
    expirationTime: oneHourLater.valueOf() / 1000,
  });

  const expirationDate = oneHourLater.toLocaleDateString('en', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });

  const expectedresponse = [
    {
      access_token: unexpiredToken,
      token_type: 'Bearer',
      expiration_date: expirationDate,
    },
  ];

  nock('https://urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, expectedresponse);

  const token = await getEDLToken(username, password, 'PROD');
  t.is(token, unexpiredToken);
});

test.serial('retrieveToken throws exception where invalid user credential', async (t) => {
  const { username, password } = t.context;
  const expectedresponse = '{"error":"invalid_credentials","error_description":"Invalid user credentials"}';
  nock('https://urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(401, expectedresponse);

  await t.throwsAsync(
    () => getEDLToken(username, password, 'PROD'),
    {
      name: 'Error',
      message: 'EarthdataLogin error: {"error":"invalid_credentials","error_description":"Invalid user credentials"},  statusCode: 401, statusMessage: Unauthorized. Earthdata Login Request failed',
    }
  );
});

test.serial('createToken creates a token for the user', async (t) => {
  const { username, password } = t.context;
  const expectedresponse =
    {
      access_token: 'ABCDE',
      token_type: 'Bearer',
      expiration_date: '1/1/2999',
    };

  nock('https://urs.earthdata.nasa.gov')
    .post('/api/users/token')
    .reply(200, expectedresponse);

  const token = await createEDLToken(username, password, 'PROD');
  t.is(token, 'ABCDE');
});

test.serial('createToken throws an error where invalid user credential', async (t) => {
  const { username, password } = t.context;
  const expectedresponse = ' {"error": "invalid_credentials","error_description": "Invalid user credentials"} ';

  nock('https://urs.earthdata.nasa.gov')
    .post('/api/users/token')
    .reply(401, expectedresponse);

  await t.throwsAsync(
    () => createEDLToken(username, password, 'PROD'),
    {
      name: 'Error',
      message: 'EarthdataLogin error: {"error":"invalid_credentials","error_description":"Invalid user credentials"},  statusCode: 401, statusMessage: Unauthorized. Earthdata Login Request failed',
    }
  );
});

test('createEDLToken returns the access token', async (t) => {
  const { username, password, postResponse } = t.context;

  nock('https://sit.urs.earthdata.nasa.gov')
    .post('/api/users/token')
    .reply(200, postResponse);

  const createdToken = await createEDLToken(username, password, 'SIT');

  t.is(createdToken, postResponse.access_token);
});

test('createEDLToken sends the correct credentials', async (t) => {
  const { username, password, postResponse } = t.context;

  const scope = nock('https://sit.urs.earthdata.nasa.gov')
    .post('/api/users/token')
    .reply(200, postResponse);

  t.plan(1);

  scope.on('request', (req) => {
    t.is(req.headers.authorization, buildBasicAuthHeader(username, password));
  });

  await createEDLToken(username, password, 'SIT');
});

test('retrieveEDLToken returns undefined if the returned token is expired', async (t) => {
  const { username, password } = t.context;

  const now = new Date();
  const oneHourAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() - 1);

  const expiredToken = createToken({
    expirationTime: oneHourAgo.valueOf() / 1000,
  });

  const expirationDate = oneHourAgo.toLocaleDateString('en', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });

  nock('https://sit.urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, [{
      access_token: expiredToken,
      expiration_date: expirationDate,
    }]);

  const result = await retrieveEDLToken(username, password, 'SIT');

  t.is(result, undefined);
});

test('retrieveEDLToken returns the token if it expires later the same day', async (t) => {
  // There is a race condition in this test that could pop up if the test is run near midnight

  const { username, password } = t.context;
  const now = new Date();

  const fiveSecondsFromNow = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
    now.getHours(), now.getMinutes(), now.getSeconds() + 5);

  const token = createToken({
    expirationTime: fiveSecondsFromNow.valueOf() / 1000,
  });

  nock('https://sit.urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, buildGetTokensResponse([token]));
  const result = await retrieveEDLToken(username, password, 'sit');

  t.is(result, token);
});

test('retrieveEDLToken returns the last-expiring token if there are multiple tokens', async (t) => {
  const { username, password } = t.context;

  const now = new Date();
  const day = now.getUTCDate();
  const oneDayLater = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day + 1));
  const twoDaysLater = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day + 2));
  const threeDaysLater = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day + 3));
  const expirationDates = [oneDayLater, twoDaysLater, threeDaysLater];
  const tokens = expirationDates.map((a) => (createToken({ expirationTime: a.valueOf() / 1000 })));
  const expectedToken = tokens[2];

  // First expiring, then second, then third
  nock('https://sit.urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, buildGetTokensResponse([tokens[0], tokens[1], tokens[2]]));

  const result1 = await retrieveEDLToken(username, password, 'SIT');

  t.is(result1, expectedToken);

  // Second Expiring, then third, then first
  nock('https://sit.urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, buildGetTokensResponse([tokens[1], tokens[2], tokens[0]]));

  const result2 = await retrieveEDLToken(username, password, 'SIT');

  t.is(result2, expectedToken);
});

test('retrieveEDLToken returns the last-expiring token if there are multiple tokens that expire on the same day', async (t) => {
  const { username, password } = t.context;

  const now = new Date();
  const firstExp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1);
  const secondExp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 2);
  const expirationDates = [firstExp, secondExp];
  const tokens = expirationDates.map((a) => (createToken({ expirationTime: a.valueOf() / 1000 })));

  // First expiring, then second
  nock('https://sit.urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, buildGetTokensResponse([tokens[0], tokens[1]]));

  const result1 = await retrieveEDLToken(username, password, 'SIT');

  t.is(result1, tokens[1]);
  // Second expiring, then first
  nock('https://sit.urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, buildGetTokensResponse([tokens[1], tokens[0]]));

  const result2 = await retrieveEDLToken(username, password, 'SIT');

  t.is(result2, tokens[1]);
});

test('retrieveEDLToken sends the correct credentials', async (t) => {
  const { username, password } = t.context;

  const scope = nock('https://sit.urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, []);

  t.plan(1);

  scope.on('request', (req) => {
    t.is(req.headers.authorization, buildBasicAuthHeader(username, password));
  });

  await retrieveEDLToken(username, password, 'SIT');
});

test.serial('revokeToken revokes the user token', async (t) => {
  const { username, password } = t.context;
  const revokeToken = 'ABCDE';

  nock('https://urs.earthdata.nasa.gov')
    .post(`/api/users/revoke_token?token=${revokeToken}`)
    .reply(200);

  await t.notThrowsAsync(
    () => revokeEDLToken(username, password, 'PROD', revokeToken)
  );
});

test.serial('revokeToken throws an error with invalid user credentials', async (t) => {
  const { username, password } = t.context;
  const revokeToken = 'ABCDE';

  const expectedresponse = ' {"error": "invalid_credentials","error_description": "Invalid user credentials"} ';

  nock('https://urs.earthdata.nasa.gov')
    .post(`/api/users/revoke_token?token=${revokeToken}`)
    .reply(401, expectedresponse);

  await t.throwsAsync(
    () => revokeEDLToken(username, password, 'PROD', revokeToken),
    {
      name: 'Error',
      message: 'EarthdataLogin error:  {"error": "invalid_credentials","error_description": "Invalid user credentials"} ,  statusCode: 401, statusMessage: Unauthorized. Earthdata Login Request failed',
    }
  );
});

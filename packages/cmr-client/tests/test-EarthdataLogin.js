'use strict';

const test = require('ava');
const nock = require('nock');

const { getEDLToken, retrieveEDLToken, createEDLToken, revokeEDLToken } = require('../EarthdataLogin');
const { createToken } = require('./EarthdataLogin/utils');

test.before(() => {
  nock.disableNetConnect();
  nock.enableNetConnect(/(localhost|127.0.0.1)/);
});

test.afterEach.always(() => {
  nock.cleanAll();
});

test.after.always(() => {
  nock.enableNetConnect();
});

test.serial('retrieveToken returns a valid token', async (t) => {
  const { username, password } = t.context;

  const now = new Date();
  const oneHourLater = new Date(now.valueOf() + (60 * 60 * 1000));

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

test.serial('retrieveToken returns undefined when there is no valid token', async (t) => {
  const { username, password } = t.context;
  const expectedresponse = [];

  nock('https://urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, expectedresponse);

  const token = await retrieveEDLToken(username, password, 'PROD');
  t.is(token, undefined);
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

test.serial('getToken returns a valid token', async (t) => {
  const { username, password } = t.context;

  const now = new Date();
  const oneHourLater = new Date(now.valueOf() + (60 * 60 * 1000));

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

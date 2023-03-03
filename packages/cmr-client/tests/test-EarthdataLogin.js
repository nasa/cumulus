'use strict';

const { default: test } = require('ava');
const jwt = require('jsonwebtoken');
const moment = require('moment');
const nock = require('nock');
const { randomId } = require('@cumulus/common/test-utils');
const { getEDLToken, retrieveEDLToken, createEDLToken, revokeEDLToken } = require('../EarthdataLogin');

const buildBasicAuthHeader = (username, password) => {
  const encodedCreds = Buffer.from(`${username}:${password}`).toString('base64');

  return `Basic ${encodedCreds}`;
};

const createToken = ({ expiresIn = 3600 }) => (
  jwt.sign(
    { data: 'foobar' },
    randomId('secret'),
    { expiresIn }
  )
);

const dateFormatString = 'MM/DD/YYYY';
const buildCreateTokenRecord = ({ expiresIn = 3600 }) => (
  {
    access_token: createToken({ expiresIn }),
    token_type: 'Bearer',
    expiration_date: moment.utc().add(expiresIn, 'seconds').format(dateFormatString),
  }
);

const buildGetTokenRecord = ({ expiresIn = 3600 }) => (
  {
    access_token: createToken({ expiresIn }),
    expiration_date: moment.utc().add(expiresIn, 'seconds').format(dateFormatString),
  }
);

test.before(() => {
  nock.disableNetConnect();
});

test.beforeEach((t) => {
  t.context.username = randomId('username-');
  t.context.password = randomId('password-');
  t.context.postResponse = buildCreateTokenRecord({});
});

test.afterEach.always(() => {
  nock.cleanAll();
});

test.after.always(() => {
  nock.enableNetConnect();
});

test.serial('getToken returns a valid token', async (t) => {
  const { username, password } = t.context;

  const expectedTokenRecord = buildGetTokenRecord({});
  const unexpiredToken = expectedTokenRecord.access_token;

  nock('https://urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, [expectedTokenRecord]);

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

  const expectedTokenRecord = buildGetTokenRecord({});
  const unexpiredToken = expectedTokenRecord.access_token;

  nock('https://urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, [expectedTokenRecord]);

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
  const expectedTokenRecord = buildCreateTokenRecord({});

  nock('https://urs.earthdata.nasa.gov')
    .post('/api/users/token')
    .reply(200, expectedTokenRecord);

  const token = await createEDLToken(username, password, 'PROD');
  t.is(token, expectedTokenRecord.access_token);
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
  const expectedTokenRecord = buildGetTokenRecord({ expiresIn: -60 });

  nock('https://sit.urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, [expectedTokenRecord]);

  const result = await retrieveEDLToken(username, password, 'SIT');

  t.is(result, undefined);
});

test('retrieveEDLToken returns the token if it expires later the same day', async (t) => {
  // There is a race condition in this test that could pop up if the test is run near midnight
  const { username, password } = t.context;
  const tokenRecord = buildGetTokenRecord({ expiresIn: 5 });

  nock('https://sit.urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, [tokenRecord]);
  const result = await retrieveEDLToken(username, password, 'sit');

  t.is(result, tokenRecord.access_token);
});

test('retrieveEDLToken returns the last-expiring token if there are multiple tokens', async (t) => {
  const { username, password } = t.context;
  const expires = [30, 3600 * 12 + 2, 3600 * 12, 3600 * 12 - 2, 3600];
  const tokenRecords = expires.map((expiresIn) => buildGetTokenRecord({ expiresIn }));

  nock('https://sit.urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, tokenRecords);

  const token = await retrieveEDLToken(username, password, 'SIT');
  t.is(token, tokenRecords[1].access_token);
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

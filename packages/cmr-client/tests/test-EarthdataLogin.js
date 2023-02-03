'use strict';

const test = require('ava');
const nock = require('nock');

const { getEDLToken, retrieveEDLToken, createEDLToken, revokeEDLToken } = require('../EarthdataLogin');

const edlObj = ({
  username: 'username',
  password: 'password',
  edlEnv: 'PROD',
});

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

  const expectedresponse = [
    {
      access_token: 'ABCDE',
      token_type: 'Bearer',
      expiration_date: '1/1/2999',
    },
  ];

  nock('https://urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, expectedresponse);

  const token = await getEDLToken(edlObj.username, edlObj.password, edlObj.edlEnv);
  t.is(token, 'ABCDE');
});

test.serial('retrieveToken returns undefined when there is no valid token', async (t) => {

  const expectedresponse = [];

  nock('https://urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, expectedresponse);

  const token = await retrieveEDLToken(edlObj.username, edlObj.password, edlObj.edlEnv);
  t.is(token, undefined);
});

test.serial('retrieveToken throws exception where invalid user credential', async (t) => {

  const expectedresponse = ' {"error": "invalid_credentials","error_description": "Invalid user credentials"} ';

  nock('https://urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(401, expectedresponse);

  await t.throwsAsync(
    () => getEDLToken(edlObj.username, edlObj.password, edlObj.edlEnv),
    {
      name: 'Error',
      message: 'EarthdataLogin error: Invalid user credentials,  statusCode: 401, statusMessage: Unauthorized. Earthdata Login Request failed',
    }
  );
});

test.serial('createToken creates a token for the user', async (t) => {

  const expectedresponse = [
    {
      access_token: 'ABCDE',
      expiration_date: '1/1/2999',
    },
  ];

  nock('https://urs.earthdata.nasa.gov')
    .post('/api/users/token')
    .reply(200, expectedresponse);

  const token = await createEDLToken(edlObj.username, edlObj.password, edlObj.edlEnv);
  t.is(token, 'ABCDE');
});

test.serial('createToken throws an error where invalid user credential', async (t) => {

  const expectedresponse = ' {"error": "invalid_credentials","error_description": "Invalid user credentials"} ';

  nock('https://urs.earthdata.nasa.gov')
    .post('/api/users/token')
    .reply(401, expectedresponse);

  await t.throwsAsync(
    () => createEDLToken(edlObj.username, edlObj.password, edlObj.edlEnv),
    {
      name: 'Error',
      message: 'EarthdataLogin error: Invalid user credentials,  statusCode: 401, statusMessage: Unauthorized. Earthdata Login Request failed',
    }
  );
});

test.serial('getToken returns a valid token', async (t) => {

  const expectedresponse = [
    {
      access_token: 'ABCDE',
      token_type: 'Beaer',
      expiration_date: '1/1/2999',
    },
  ];

  nock('https://urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, expectedresponse);

  const token = await getEDLToken(edlObj.username, edlObj.password, edlObj.edlEnv);
  t.is(token, 'ABCDE');
});

test.serial('revokeToken revokes the user token', async (t) => {

  const revokeToken = 'ABCDE';

  nock('https://urs.earthdata.nasa.gov')
    .post(`/api/users/revoke_token?token=${revokeToken}`)
    .reply(200);

  await t.notThrowsAsync(
    () => revokeEDLToken(edlObj.username, edlObj.password, edlObj.edlEnv, revokeToken)
  );
});

test.serial('revokeToken throws an error with invalid user credentials', async (t) => {

  const revokeToken = 'ABCDE';

  const expectedresponse = ' {"error": "invalid_credentials","error_description": "Invalid user credentials"} ';

  nock('https://urs.earthdata.nasa.gov')
    .post(`/api/users/revoke_token?token=${revokeToken}`)
    .reply(401, expectedresponse);

  await t.throwsAsync(
    () => revokeEDLToken(edlObj.username, edlObj.password, edlObj.edlEnv, revokeToken),
    {
      name: 'Error',
      message: 'EarthdataLogin error: Invalid user credentials,  statusCode: 401, statusMessage: Unauthorized. Earthdata Login Request failed',
    }
  );
});

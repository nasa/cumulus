// @ts-check

const { default: test } = require('ava');
const nock = require('nock');
const { randomId } = require('@cumulus/common/test-utils');
const { retrieveEDLToken } = require('../../EarthdataLogin');
const { createToken, buildBasicAuthHeader, buildGetTokensResponse } = require('./utils');

test.before(() => {
  nock.disableNetConnect();
});

test.beforeEach((t) => {
  t.context.username = randomId('username-');
  t.context.password = randomId('password-');
});

test.afterEach.always(() => {
  nock.cleanAll();
});

test.after.always(() => {
  nock.enableNetConnect();
});

test('retrieveEDLToken returns undefined if there are no tokens', async (t) => {
  const { username, password } = t.context;

  nock('https://sit.urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, []);

  const result = await retrieveEDLToken(username, password, 'SIT');

  t.is(result, undefined);
});

test('retrieveEDLToken returns undefined if the returned token is expired', async (t) => {
  const { username, password } = t.context;

  const now = new Date();
  const oneHourAgo = new Date(now.valueOf() - (60 * 60 * 1000));

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
  const fiveSecondsFromNow = new Date(now.valueOf() + (5 * 1000));

  const token = createToken({
    expirationTime: fiveSecondsFromNow.valueOf() / 1000,
  });

  nock('https://sit.urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, buildGetTokensResponse([token]));

  const result = await retrieveEDLToken(username, password, 'SIT');

  t.is(result, token);
});

test('retrieveEDLToken returns the last-expiring token if there are multiple tokens', async (t) => {
  const { username, password } = t.context;

  const now = new Date();
  const nextYear = now.getFullYear() + 1;
  const julyFirstNextYear = new Date(nextYear, 6, 1);
  const juneFirstTheYearAfterNext = new Date(nextYear + 1, 5, 1);

  const firstExpiringToken = createToken({
    expirationTime: julyFirstNextYear.valueOf() / 1000,
  });
  const secondExpiringToken = createToken({
    expirationTime: juneFirstTheYearAfterNext.valueOf() / 1000,
  });

  // First expiring, then second
  nock('https://sit.urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, buildGetTokensResponse([firstExpiringToken, secondExpiringToken]));

  const result1 = await retrieveEDLToken(username, password, 'SIT');

  t.is(result1, secondExpiringToken);

  // Second expiring, then first
  nock('https://sit.urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, buildGetTokensResponse([secondExpiringToken, firstExpiringToken]));

  const result2 = await retrieveEDLToken(username, password, 'SIT');

  t.is(result2, secondExpiringToken);
});

test('retrieveEDLToken returns the last-expiring token if there are multiple tokens that expire on the same day', async (t) => {
  const { username, password } = t.context;

  const now = new Date();
  const nextYear = now.getFullYear() + 1;
  const firstExpirationDate = new Date(nextYear, 6, 1, 12, 0, 0);
  const secondExpirationDate = new Date(nextYear, 6, 1, 12, 0, 1);

  const firstExpiringToken = createToken({
    expirationTime: firstExpirationDate.valueOf() / 1000,
  });

  const secondExpiringToken = createToken({
    expirationTime: secondExpirationDate.valueOf() / 1000,
  });

  // First expiring, then second
  nock('https://sit.urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, buildGetTokensResponse([firstExpiringToken, secondExpiringToken]));

  const result1 = await retrieveEDLToken(username, password, 'SIT');

  t.is(result1, secondExpiringToken);

  // Second expiring, then first
  nock('https://sit.urs.earthdata.nasa.gov')
    .get('/api/users/tokens')
    .reply(200, buildGetTokensResponse([secondExpiringToken, firstExpiringToken]));

  const result2 = await retrieveEDLToken(username, password, 'SIT');

  t.is(result2, secondExpiringToken);
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

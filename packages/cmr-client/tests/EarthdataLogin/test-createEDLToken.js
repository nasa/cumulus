// @ts-check

const { default: test } = require('ava');
const nock = require('nock');
const { randomId } = require('@cumulus/common/test-utils');
const { createEDLToken } = require('../../EarthdataLogin');
const { createToken, buildCreateTokenResponse, buildBasicAuthHeader } = require('./utils');

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

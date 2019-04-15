'use strict';

const test = require('ava');

const { OAuth2 } = require('../../lib/OAuth2');

test('OAuth2.getAuthorizationUrl() throws a "Not implemented" error', async (t) => {
  const oAuth2 = new OAuth2();

  try {
    oAuth2.getAuthorizationUrl();
    t.fail('Expected error to be thrown');
  } catch (err) {
    t.is(err.message, 'Not implemented');
  }
});

test('OAuth2.getAccessToken() throws a "Not implemented" error', async (t) => {
  const oAuth2 = new OAuth2();

  try {
    await oAuth2.getAccessToken();
    t.fail('Expected error to be thrown');
  } catch (err) {
    t.is(err.message, 'Not implemented');
  }
});

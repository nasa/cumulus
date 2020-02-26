'use strict';

const isMatch = require('lodash.ismatch');
const test = require('ava');
const rewire = require('rewire');
const FormData = require('form-data');
const base64 = require('base-64');

const authTokenRewire = rewire('../auth-token');

test.serial('getEdlAuthorization returns the location if error is a "successful" 302', async (t) => {
  const expected = new Error();
  expected.statusCode = 302;
  expected.headers = { location: 'redirect' };

  const getEdlAuthorization = authTokenRewire.__get__('getEdlAuthorization');
  const gotRestore = authTokenRewire.__set__('got', {
    post: async () => {
      throw expected;
    }
  });
  const actual = await getEdlAuthorization('url', '', 'redirect');
  t.is(actual, 'redirect');
  gotRestore();
});


test.serial('getEdlAuthorization throws error if error is not a "successful" 302', async (t) => {
  const expected = new Error();
  expected.statusCode = 500;
  expected.headers = { location: 'Internal Server Error' };

  const getEdlAuthorization = authTokenRewire.__get__('getEdlAuthorization');


  const gotRestore = authTokenRewire.__set__('got', {
    post: async () => {
      throw expected;
    }
  });
  await t.throwsAsync(getEdlAuthorization({}, '', { is: expected }));
  gotRestore();
});

test.serial('getEdlAuthorization throws error if no error thrown on post', async (t) => {
  const messageRegexp = new RegExp(/Invalid endpoint configuration/);
  const getEdlAuthorization = authTokenRewire.__get__('getEdlAuthorization');
  const gotRestore = authTokenRewire.__set__('got', {
    post: async () => true
  });
  await t.throwsAsync(getEdlAuthorization({}, '', { message: messageRegexp }));
  gotRestore();
});


test.serial('getLaunchpadToken calls launchpad.getLaunchPadToken with configured values', async (t) => {
  const passphrase = 'passphrase';
  const token = 'launchpad token';
  const api = 'https://api.launchpad.nasa.gov/icam/api/sm/v1/gettoken';
  const certificate = 'launchpad.pfx';
  const launchpadRestore = authTokenRewire.__set__('launchpad', {
    getLaunchpadToken: async (config) => {
      if (isMatch(config, { passphrase, api, certificate })) {
        return token;
      }
      return 'fail';
    }
  });

  const actual = await authTokenRewire.getLaunchpadToken({
    launchpadPassphrase: passphrase,
    launchpadApi: api,
    launchpadCertificate: certificate
  });
  launchpadRestore();
  t.is(actual, token);
});


test.serial('getEdlToken returns expected token given expected API returns', async (t) => {
  const username = 'user';
  const password = 'password';
  const token = 'token';
  const baseUrl = 'https://foo.bar/dev/';
  const gotRestore = authTokenRewire.__set__('got', {
    get: async (url, _) => {
      if (url === 'https://foo.bar/dev/token') {
        return { headers: { location: 'location' } };
      }
      if (url === 'token-redirect') {
        return { body: `{ "message": { "token": "${token}" }}` };
      }
      throw new Error(`Test failing as ${JSON.stringify(url)} was not matched`);
    }
  });

  const getEdlAuthorizationRestore = authTokenRewire.__set__('getEdlAuthorization', async (url, form, _base) => {
    const formCheck = new FormData();
    formCheck.append('credentials', base64.encode(`${username}:${password}`));
    if (url === 'location') {
      t.is(form._streams[1], formCheck._streams[1]);
      return 'token-redirect';
    }
    return 'fail';
  });

  const actual = await authTokenRewire.getEdlToken({ baseUrl, username, password });

  getEdlAuthorizationRestore();
  gotRestore();

  t.is(actual, token);
});


test.serial('getAuthToken calls getLaunchpadToken with passed configuration values', async (t) => {
  const config = 'dummy config object';
  const getLaunchpadTokenRestore = authTokenRewire.__set__('getLaunchpadToken', async (param) => param);
  const actual = await authTokenRewire.getAuthToken('launchpad', config);

  getLaunchpadTokenRestore();
  t.is(actual, config);
});

test.serial('getAuthToken calls getEdlToken with passed configuration values', async (t) => {
  const config = 'dummy config object';
  const getEdlTokenRestore = authTokenRewire.__set__('getEdlToken', async (param) => param);
  const actual = await authTokenRewire.getAuthToken('earthdata', config);

  getEdlTokenRestore();
  t.is(actual, config);
});

test.serial('getAuthToken throws error when called with google auth provider', async (t) => {
  const config = 'dummy config object';
  const expected = authTokenRewire.__get__('AuthTokenError');
  await t.throwsAsync(authTokenRewire.getAuthToken('google', config, { instanceOf: expected }));
});


test.serial('getAuthToken throws error when called with unknown auth provider', async (t) => {
  const config = 'dummy config object';
  const expected = authTokenRewire.__get__('AuthTokenError');
  await t.throwsAsync(authTokenRewire.getAuthToken('foobar', config, { instanceOf: expected }));
});

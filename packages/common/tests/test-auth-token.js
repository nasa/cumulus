'use strict';

const isMatch = require('lodash.ismatch');
const test = require('ava');
const rewire = require('rewire');
const FormData = require('form-data');
const base64 = require('base-64');

const authTokenRewire = rewire('../auth-token');

test.serial('getEdlToken returns the error if error is a "successful" 302', async (t) => {
  const expected = new Error();
  expected.statusCode = 302;
  expected.headers = { location: 'location' };

  const getEdlToken = authTokenRewire.__get__('getEdlToken');
  const gotRestore = authTokenRewire.__set__('got', {
    post: async () => {
      throw expected;
    }
  });
  const actual = await getEdlToken({}, '');
  t.is(actual, expected);
  gotRestore();
});


test.serial('getEdlToken throws error if error is not a "successful" 302', async (t) => {
  const expected = new Error();
  expected.statusCode = 500;
  expected.headers = { location: 'Internal Server Error' };

  const getEdlToken = authTokenRewire.__get__('getEdlToken');


  const gotRestore = authTokenRewire.__set__('got', {
    post: async () => {
      throw expected;
    }
  });
  await t.throwsAsync(getEdlToken({}, '', { is: expected }));
  gotRestore();
});

test.serial('getEdlToken throws error if no error thrown on post', async (t) => {
  const messageRegexp = new RegExp(/Invalid endpoint configuration/);
  const getEdlToken = authTokenRewire.__get__('getEdlToken');
  const gotRestore = authTokenRewire.__set__('got', {
    post: async () => {
      return true;
    }
  });
  await t.throwsAsync(getEdlToken({}, '', { message: messageRegexp }));
  gotRestore();
});


test.serial('getAuthToken calls getLaunchPadToken with configured values', async (t) => {
  const passphrase = 'passphrase';
  const token = 'launchpad token';
  const api = 'https://api.launchpad.nasa.gov/icam/api/sm/v1/gettoken'
  const certificate = 'launchpad.pfx';
  const getAuthToken = authTokenRewire.__get__('getAuthToken');
  const launchpadRestore = authTokenRewire.__set__('launchpad', {
    getLaunchpadToken: async (config) => {
      if (isMatch(config, { passphrase, api, certificate })) {
        return token;
      }
      return 'fail';
    }
  });

  const actual = await getAuthToken('launchpad', { passphrase });
  launchpadRestore();
  t.is(actual, token);
});


test.serial('getAuthToken returns expected token given expected API returns', async (t) => {
  const username = 'user';
  const password = 'password';
  const token = 'token'
  const baseUrl = 'https://foo.bar';
  const getAuthToken = authTokenRewire.__get__('getAuthToken');
  const gotRestore = authTokenRewire.__set__('got', {
    get: async (url, _) => {
      if (url === 'https://foo.bar/dev/token') {
        return { headers: { location: 'location' } };
      }
      if (url === 'token-redirect') {
        return { body: `{ "message": { "token": "${token}" }}` };
      }
    }
  });

  const getEdlTokenRestore = authTokenRewire.__set__('getEdlToken', async (urlObj, form) => {
    const formCheck = new FormData();
    formCheck.append('credentials', base64.encode(`${username}:${password}`));
    if (urlObj.pathname === 'location') {
      t.is(form._streams[1], formCheck._streams[1]);
      return { headers: { location: 'token-redirect' } };
    }
    return 'fail';
  });

  const actual = await getAuthToken('earthdata', { baseUrl, username, password });

  getEdlTokenRestore();
  gotRestore();

  t.is(actual, token);
});

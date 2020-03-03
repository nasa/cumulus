'use strict';

const test = require('ava');
const FormData = require('form-data');
const base64 = require('base-64');
const rewire = require('rewire');


const EdlApiClientRewire = rewire('../cumulus-api-client/EdlApiClient.js');

const CONFIG = {
  kmsId: 'fakeKmsId',
  baseUrl: 'https://foo.bar/dev/',
  username: 'fakeUsername',
  token: 'fakeToken',
  password: 'fakePassword',
  tokenSecretName: 'fakeTokenSecretName',
  authTokenTable: 'fakeAuthTokenTable'
};


test.serial('createNewAuthToken return token given expected API returns', async (t) => {
  const token = 'mockToken';
  const gotRestore = EdlApiClientRewire.__set__('got', {
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

  const testEdlClient = new EdlApiClientRewire(CONFIG);

  testEdlClient.getEdlAuthorization = async (url, form, _base) => {
    const formCheck = new FormData();
    formCheck.append('credentials', base64.encode(`${CONFIG.username}:${CONFIG.password}`));
    if (url === 'location') {
      t.is(form._streams[1], formCheck._streams[1]);
      return 'token-redirect';
    }
    return 'fail';
  };

  const actual = await testEdlClient.createNewAuthToken();
  gotRestore();

  t.is(actual, token);
});

test.serial('getEdlAuthorization throws endpoint response error if error is not a "successful" 302', async (t) => {
  const expected = new Error();
  expected.statusCode = 500;
  expected.headers = { location: 'Internal Server Error' };

  const gotRestore = EdlApiClientRewire.__set__('got', {
    post: async () => {
      throw expected;
    }
  });
  const testEdlClient = new EdlApiClientRewire(CONFIG);
  await t.throwsAsync(testEdlClient.getEdlAuthorization({}, '', { is: expected }));
  gotRestore();
});

test.serial('getEdlAuthorization throws error if no error thrown on post', async (t) => {
  const messageRegexp = new RegExp(/Invalid endpoint configuration/);
  const gotRestore = EdlApiClientRewire.__set__('got', {
    post: async () => true
  });
  const testEdlClient = new EdlApiClientRewire(CONFIG);
  await t.throwsAsync(testEdlClient.getEdlAuthorization({}, '', { message: messageRegexp }));
  gotRestore();
});

test.serial('getEdlAuthorization returns the location if endpoint response is a "successful" 302', async (t) => {
  const expected = new Error();
  expected.statusCode = 302;
  expected.headers = { location: 'https://foo.bar/path' };

  const gotRestore = EdlApiClientRewire.__set__('got', {
    post: async (urlArg, optionsArg) => {
      t.deepEqual('https://some_oauth_url/', urlArg);
      t.deepEqual({
        body: 'someformmock',
        headers: {
          origin: 'https://some_oauth_url'
        }
      }, optionsArg);
      throw expected;
    }
  });

  const testEdlClient = new EdlApiClientRewire(CONFIG);
  const actual = await testEdlClient.getEdlAuthorization('https://some_oauth_url', 'someformmock', 'https://foo.bar/path');

  t.is(actual, 'https://foo.bar/path');
  gotRestore();
});

'use strict';

const test = require('ava');
const rewire = require('rewire');

const LaunchpadApiRewire = rewire('../LaunchpadApiClient.js');

const CONFIG = {
  launchpadPassphrase: 'passphrase',
  launchpadToken: 'launchpad token',
  launchpadApi: 'https://api.launchpad',
  launchpadCertificate: 'somefile.pfx',
  tokenSecretName: 'fakeTokenSecretName',
  authTokenTable: 'fakeAuthTokenTable',
  kmsId: 'fakeKmsId',
  userGroup: 'userGroup',
  baseUrl: 'http://fakeurl'
};

test.before(() => {
  LaunchpadApiRewire.__set__('LaunchpadToken', class RewiredLaunchpadToken {
    constuctor() { }

    async requestToken() {
      return 'fake token';
    }
  });
});

test.beforeEach((t) => {
  t.context.client = new LaunchpadApiRewire(CONFIG);
});
test.serial('createNewAuthToken calls launchpad.requestToken ', async (t) => {
  t.context.client.launchpadToken.requestToken = async () => ({ sm_token: 'launchpad response' });
  const actual = await t.context.client.createNewAuthToken();
  t.is(actual, 'launchpad response');
});

test.serial('getTokenTimeLeft returns correct time left on token', async (t) => {
  t.context.client.launchpadToken.validateToken = async (_token) => ({
    session_idleremaining: 50,
    session_maxremaining: 100
  });
  const actual = await t.context.client.getTokenTimeLeft();
  t.is(actual, 100);
});

test.serial('refreshAuthToken throws an error', async (t) => {
  await t.throwsAsync(t.context.client.refreshAuthToken());
});

test.serial('_validateTokenExpiry returns true', async (t) => {
  const actual = await t.context.client._validateTokenExpiry();
  t.is(actual, true);
});

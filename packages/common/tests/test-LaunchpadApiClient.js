'use strict';

const test = require('ava');
const rewire = require('rewire');

const LaunchpadApiRewire = rewire('../cumulus-api-client/LaunchpadApiClient.js');

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

test.serial('createNewAuthToken calls launchpad.requestToken ', async (t) => {
  const testLaunchpadApiClient = new LaunchpadApiRewire(CONFIG);
  testLaunchpadApiClient.launchpadToken.requestToken = async () => ({ sm_token: 'launchpad response' });
  const actual = await testLaunchpadApiClient.createNewAuthToken();
  t.is(actual, 'launchpad response');
});

test.serial('getTokenTimeLeft returns correct time left on token', async (t) => {
  const testLaunchpadApiClient = new LaunchpadApiRewire(CONFIG);
  testLaunchpadApiClient.launchpadToken.validateToken = async (_token) => ({
    session_idleremaining: 50,
    session_maxremaining: 100
  });
  const actual = await testLaunchpadApiClient.getTokenTimeLeft();
  t.is(actual, 100);
});

test.serial('refreshAuthToken throws an error', async (t) => {
  const testLaunchpadApiClient = new LaunchpadApiRewire(CONFIG);
  await t.throwsAsync(testLaunchpadApiClient.refreshAuthToken());
});

test.serial('validateTokenExpiry returns true', async (t) => {
  const testLaunchpadApiClient = new LaunchpadApiRewire(CONFIG);
  const actual = await testLaunchpadApiClient.validateTokenExpiry();
  t.is(actual, true);
});

'use strict';

const test = require('ava');
const sinon = require('sinon');
const got = require('got');
const { randomId } = require('@cumulus/common/test-utils');
const {
  submitQueryToLzards,
  getAuthToken,
} = require('../lzards');

const sandbox = sinon.createSandbox();

const initializeEnvVars = () => {
  process.env.lzards_api = 'fakeLzardsApi';
  process.env.launchpad_api = 'fakeLaunchpadApi';
  process.env.lzards_launchpad_certificate = 'fakeLaunchpadCertificate';
  process.env.lzards_launchpad_passphrase_secret_name = 'fakeLzardsLaunchpadPassphraseSecretName';
  process.env.system_bucket = 'fakeSystemBucket';
  process.env.stackName = 'fakeStackName';
  process.env.lzards_provider = 'fakeProvider';
};

const resetEnvVars = () => {
  initializeEnvVars();
};

test.before(() => {
  initializeEnvVars();
});

test.afterEach.always(() => {
  sandbox.reset();
  resetEnvVars();
});

test.after.always(() => {
  sandbox.restore();
});

test.serial('submitQueryToLzards returns error status when lzards_api environment is not set',
  async (t) => {
    delete process.env.lzards_api;
    const searchParams = {
      test: 1,
    };

    await t.throwsAsync(submitQueryToLzards({ searchParams }),
      { name: 'MissingRequiredEnvVarError', message: 'The lzards_api environment variable must be set' });
  });

test.serial('submitQueryToLzards returns error status when searchParams are not provided',
  async (t) => {
    process.env.lzards_api = 'fake_lzards_api';
    await t.throwsAsync(submitQueryToLzards({ }),
      { name: 'Error', message: 'The required searchParams is not provided or empty' });
  });

test.serial('submitQueryToLzards returns error status when searchParams is empty',
  async (t) => {
    process.env.lzards_api = 'fake_lzards_api';
    await t.throwsAsync(submitQueryToLzards({ searchParams: {} }),
      { name: 'Error', message: 'The required searchParams is not provided or empty' });
  });

test.serial('submitQueryToLzards sends request to lzards api',
  async (t) => {
    const granuleId = randomId('granId');
    const collection = randomId('collectionId');
    const fakeLaunchpadToken = 'fakeLaunchpadToken';
    const fakeGetAuthToken = sinon.stub().resolves(fakeLaunchpadToken);

    const searchParams = {
      metadata: {
        collection,
        granuleId,
      },
    };
    const requestUrl = `${process.env.lzards_api}`;
    const requestBody = {
      searchParams: { ...searchParams, provider: process.env.lzards_provider },
      responseType: 'json',
      throwHttpErrors: false,
      headers: {
        Authorization: `Bearer ${fakeLaunchpadToken}`,
      },
    };

    sinon.replace(got, 'get', sinon.stub().resolves({ statusCode: 200 }));

    const response = await submitQueryToLzards(
      {
        searchParams,
        getAuthTokenFunction: fakeGetAuthToken,
      }
    );

    t.true(got.get.calledWith(requestUrl, requestBody));
    t.is(response.statusCode, 200);
  });

test.serial('getAuthToken throws an error if launchpad_api environment variable is not present',
  async (t) => {
    delete process.env.launchpad_api;
    await t.throwsAsync(getAuthToken(),
      { name: 'MissingRequiredEnvVarError', message: 'The launchpad_api environment variable must be set' });
  });

test.serial('getAuthToken throws an error if lzards_launchpad_passphrase_secret_name environment variable is not present',
  async (t) => {
    delete process.env.lzards_launchpad_passphrase_secret_name;
    await t.throwsAsync(getAuthToken(),
      { name: 'MissingRequiredEnvVarError', message: 'The lzards_launchpad_passphrase_secret_name environment variable must be set' });
  });

test.serial('getAuthToken throws an error if lzards_launchpad_certificate environment variable is not present',
  async (t) => {
    delete process.env.lzards_launchpad_certificate;
    const fakeGetSecretString = sinon.stub().resolves('fakeSecretString');
    await t.throwsAsync(getAuthToken(fakeGetSecretString),
      { name: 'MissingRequiredEnvVarError', message: 'The lzards_launchpad_certificate environment variable must be set' });
  });

test.serial('getAuthToken throws an error if getSecretString() fails to return secret',
  async (t) => {
    const fakeGetSecretString = sinon.stub().resolves(undefined);
    await t.throwsAsync(getAuthToken(fakeGetSecretString),
      { name: 'GetAuthTokenError', message: 'The value stored in "launchpad_passphrase_secret_name" must be defined' });
  });

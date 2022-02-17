'use strict';

const test = require('ava');
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const { randomId } = require('@cumulus/common/test-utils');

const sandbox = sinon.createSandbox();
const fakeGetToLzards = sandbox.stub();
const fakeGetRequiredEnvVar = sandbox.stub();
const fakeGetSecretString = sandbox.stub();
const fakeGetLaunchpadToken = sandbox.stub();
const lzards = proxyquire('../../lib/lzards', {
  got: {
    get: fakeGetToLzards,
  },
  '@cumulus/common/env': {
    getRequiredEnvVar: fakeGetRequiredEnvVar,
  },
  '@cumulus/aws-client/SecretsManager': {
    getSecretString: fakeGetSecretString,
  },
  '@cumulus/launchpad-auth': {
    getLaunchpadToken: fakeGetLaunchpadToken,
  },
});

const lzardsGetAuthToken = proxyquire('../../lib/lzards', {
  got: {
    get: fakeGetToLzards,
  },
  '@cumulus/aws-client/SecretsManager': {
    getSecretString: fakeGetSecretString,
  },
});

test.afterEach.always(() => {
  sandbox.reset();
});

test.after.always(() => {
  sandbox.restore();
});

test.serial('getRequestToLzards returns error status when lzards_api environment is not set',
  async (t) => {
    await t.throwsAsync(lzards.getRequestToLzards({ queryParams: 'test=1' }),
      { name: 'Error', message: 'The lzards_api environment variable is not set' });
  });

test.serial('getRequestToLzards returns error status when queryParams are not provided',
  async (t) => {
    process.env.lzards_api = 'fake_lzards_api';
    await t.throwsAsync(lzards.getRequestToLzards({ }),
      { name: 'Error', message: 'The required queryParams parameter is not set' });
  });

test.serial('getRequestToLzards sends request to lzards api',
  async (t) => {
    process.env.lzards_api = 'fake_lzards_api';
    const granuleId = randomId('granId');
    const collection = randomId('collectionId');
    const fakeLaunchpadToken = 'fakeLaunchpadToken';
    fakeGetRequiredEnvVar.resolves('fakeLaunchpadApi');
    fakeGetSecretString.resolves('fakeSecretString');
    fakeGetLaunchpadToken.resolves(fakeLaunchpadToken);
    fakeGetToLzards.resolves({
      statusCode: 200,
      body: {
        httpStatus: 200,
      },
    });

    const queryParams = `?metadata[collection]=${collection}&metadata[granuleId]=${granuleId}`;
    const requestUrl = `${process.env.lzards_api}${queryParams}`;
    const requestBody = {
      responseType: 'json',
      throwHttpErrors: false,
      headers: {
        Authorization: `Bearer ${fakeLaunchpadToken}`,
      },
    };

    const response = await lzards.getRequestToLzards({ queryParams });

    t.true(fakeGetToLzards.calledWith(requestUrl, requestBody));
    t.is(response.statusCode, 200);
  });

test.serial('getAuthToken throws an error if launchpad_api environment variable is not present',
  async (t) => {
    process.env.lzards_api = 'fake_lzards_api';
    await t.throwsAsync(lzardsGetAuthToken.getRequestToLzards({ queryParams: 'test=1' }),
      { name: 'MissingRequiredEnvVarError', message: 'The launchpad_api environment variable must be set' });
  });

test.serial('getAuthToken throws an error if launchpad_passphrase_secret_name environment variable is not present',
  async (t) => {
    process.env.lzards_api = 'fake_lzards_api';
    process.env.launchpad_api = 'fake_launchpad_api';
    await t.throwsAsync(lzardsGetAuthToken.getRequestToLzards({ queryParams: 'test=1' }),
      { name: 'MissingRequiredEnvVarError', message: 'The launchpad_passphrase_secret_name environment variable must be set' });
  });

test.serial('getAuthToken throws an error if launchpad_certificate environment variable is not present',
  async (t) => {
    fakeGetSecretString.resolves('fakeSecretString');
    process.env.lzards_api = 'fake_lzards_api';
    process.env.launchpad_api = 'fake_launchpad_api';
    process.env.launchpad_passphrase_secret_name = 'fake_launchpad_passphrase_secret_name';
    await t.throwsAsync(lzardsGetAuthToken.getRequestToLzards({ queryParams: 'test=1' }),
      { name: 'MissingRequiredEnvVarError', message: 'The launchpad_certificate environment variable must be set' });
  });

test.serial('getAuthToken throws an error if getSecretString() fails to return secret',
  async (t) => {
    fakeGetSecretString.resolves(undefined);
    process.env.lzards_api = 'fake_lzards_api';
    process.env.launchpad_api = 'fake_launchpad_api';
    process.env.launchpad_passphrase_secret_name = 'fake_launchpad_passphrase_secret_name';
    await t.throwsAsync(lzardsGetAuthToken.getRequestToLzards({ queryParams: 'test=1' }),
      { name: 'Error', message: 'The value stored in "launchpad_passphrase_secret_name" must be defined' });
  });

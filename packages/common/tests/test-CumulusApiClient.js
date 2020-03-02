'use strict';

// Things to mock: _getAuthTokenRecord, _updateAuthTokenRecord

const { createKey, decryptBase64String } = require('@cumulus/aws-client/KMS');
const test = require('ava');
const rewire = require('rewire');
const { dynamodb, dynamodbDocClient } = require('@cumulus/aws-client/services');

const { randomId } = require('../test-utils');

const CumulusApiClientRewire = rewire('../cumulus-api-client/CumulusApiClient.js');
const CumulusAuthTokenError = require('../cumulus-api-client/CumulusAuthTokenError');

test.before(async (t) => {
  process.env.tableName = randomId('table');
  dynamodb().createTable({
    TableName: process.env.tableName,
    AttributeDefinitions: [
      { AttributeName: 'tokenAlias', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'tokenAlias', KeyType: 'HASH' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  }).promise();

  const kmsResponse = await createKey();
  const kmsId = kmsResponse.KeyMetadata.KeyId;

  t.context.config = {
    kmsId,
    authTokenTable: process.env.tableName,
    tokenSecretName: 'tokenSecretName',
    baseUrl: 'http://fakeurl'
  };
});

test.after.always(
  () => dynamodb().deleteTable({ TableName: process.env.tableName }).promise()
);

test.serial('getCacheAuthToken updates and retreives expired token from the database', async (t) => {
  const token = 'expiredToken';
  const updatedToken = 'updatedToken';
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient._updateAuthTokenRecord(token);
  testApiClient._validateTokenExpiry = async () => {
    throw new CumulusAuthTokenError('Token expired, obtaining new token');
  };
  testApiClient.createNewAuthToken = async () => updatedToken;

  const actual = await testApiClient.getCacheAuthToken();
  t.is(updatedToken, actual);
});

test.serial('getCacheAuthToken returns a bearer token from getAuthTokenRecord if token is not expired', async (t) => {
  const token = 'mockToken';
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient._getAuthTokenRecord = async () => token;
  testApiClient._validateTokenExpiry = async () => true;
  const actual = await testApiClient.getCacheAuthToken();
  t.is(token, actual);
});

test.serial('getCacheAuthToken gets a new token and updates the record if token is expired', async (t) => {
  const mockToken = 'mockToken';
  const updatedToken = 'updatedToken';
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient._getAuthTokenRecord = async () => mockToken;
  testApiClient._getTokenTimeLeft = async () => 0;
  testApiClient.createNewAuthToken = async () => updatedToken;

  testApiClient._updateAuthTokenRecord = async (token) => {
    t.is(updatedToken, token);
    return true;
  };
  const actual = await testApiClient.getCacheAuthToken();
  t.is(updatedToken, actual);
});

test.serial('getCacheAuthToken returns token from getAuthToken if getAuthTokenRecord throws a CumulusAuthTokenError', async (t) => {
  const updateToken = 'updatedToken';
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient._getAuthTokenRecord = async () => {
    throw new CumulusAuthTokenError();
  };
  testApiClient.createNewAuthToken = async () => updateToken;
  testApiClient._updateAuthTokenRecord = async () => true;
  const actual = await testApiClient.getCacheAuthToken();
  t.is(updateToken, actual);
});

test.serial('getCacheAuthToken throws an error if _getAuthTokenRecord throws an Error', async (t) => {
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient._getAuthTokenRecord = async () => {
    throw new Error('Error Message');
  };
  await t.throwsAsync(testApiClient.getCacheAuthToken());
});

test.serial('getCacheAuthToken throws an error if _validateTokenExpiry throws an Error', async (t) => {
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient._getAuthTokenRecord = async () => 'mockToken';
  testApiClient._validateTokenExpiry = async () => {
    throw new Error('Error Message');
  };
  await t.throwsAsync(testApiClient.getCacheAuthToken());
});

test.serial('_validateTokenExipry throws CumulusAuthTokenError if time is expired', async (t) => {
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient._getTokenTimeLeft = async () => 0;
  await t.throwsAsync(testApiClient._validateTokenExpiry());
});

test.serial('_validateTokenExipry throws CumulusAuthTokenError is near expiration', async (t) => {
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient._getTokenTimeLeft = async () => 5;
  await t.throwsAsync(testApiClient._validateTokenExpiry());
});

test.serial('_validateTokenExipry returns if token is valid', async (t) => {
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient._getTokenTimeLeft = async () => 50000;
  t.pass(await testApiClient._validateTokenExpiry());
});

test.serial('_getTokenTimeLeft returns time left', async (t) => {
  const mockToken = 'some token value';
  const decodeRestore = CumulusApiClientRewire.__set__('decode', (token) => {
    t.is(token, mockToken);
    return { exp: 1752955173 };
  });
  const dateRestore = CumulusApiClientRewire.__set__('Date', { now: () => 1652955173156 });

  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient._getTokenTimeLeft = async () => 50000;
  const actual = await testApiClient._getTokenTimeLeft(mockToken);
  decodeRestore();
  dateRestore();
  t.is(50000, actual);
});

test.serial('_updateAuthTokenRecord writes an encrypted token', async (t) => {
  const token = `updateTokenTestToken${randomId()}`;
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  await testApiClient._updateAuthTokenRecord(token);
  const params = {
    TableName: t.context.config.authTokenTable,
    Key: {
      tokenAlias: t.context.config.tokenSecretName
    }
  };
  const docResponse = await dynamodbDocClient().get(params).promise();
  const actual = await decryptBase64String(docResponse.Item.bearerToken);
  t.is(token, actual);
});

test.serial('_getAuthTokenRecord retrieves a previously stored record', async (t) => {
  const token = `updateAndRetrieveTokenTestToken${randomId()}`;
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  await testApiClient._updateAuthTokenRecord(token);
  const actual = await testApiClient._getAuthTokenRecord();
  t.is(token, actual);
});

test.serial('createNewAuthToken is not implemented in the base class', async (t) => {
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  await t.throwsAsync(testApiClient.createNewAuthToken());
});

test.serial('get attempts to call the url with a previous stored auth token', async (t) => {
  const authToken = 'someAuthToken';
  const gotRestore = CumulusApiClientRewire.__set__('got', {
    get: async (url, headers) => {
      t.is(`${t.context.config.baseUrl}/endpoint`, url);
      t.deepEqual({ headers: { Authorization: `Bearer ${authToken}` } }, headers);
      return 'got return value';
    }
  });
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient.getCacheAuthToken = async () => authToken;
  t.is('got return value', await testApiClient.get('endpoint'));
  gotRestore();
});

test.serial('get retries/createes a token the expected number of times, then throws an error', async (t) => {
  t.context.get_retries_counter = 0;
  const getUrl = 'http://foo.bar';
  const authToken = 'someAuthToken';
  const gotRestore = CumulusApiClientRewire.__set__('got', {
    get: async (_url, _headers) => {
      t.context.get_retries_counter += 1;
      throw new Error('Access token has expired');
    }
  });
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient.createNewAuthToken = async () => 'mockToken';
  testApiClient.getCacheAuthToken = async () => authToken;
  await t.throwsAsync(testApiClient.get(getUrl, 4));
  t.is(t.context.get_retries_counter, 5);
  gotRestore();
});

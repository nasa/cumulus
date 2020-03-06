'use strict';

const test = require('ava');
const rewire = require('rewire');

const { createKey, decryptBase64String } = require('@cumulus/aws-client/KMS');
const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const { createAndWaitForDynamoDbTable, deleteAndWaitForDynamoDbTableNotExists } = require('@cumulus/aws-client/DynamoDb');

const { randomId } = require('@cumulus/common/test-utils');

const CumulusApiClientRewire = rewire('../CumulusApiClient.js');
const CumulusAuthTokenError = require('../CumulusAuthTokenError');

test.before(async (t) => {
  process.env.tableName = randomId('table');
  await createAndWaitForDynamoDbTable({
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
  });

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
  async () => deleteAndWaitForDynamoDbTableNotExists({ TableName: process.env.tableName })
);

test.serial('getCacheAuthToken initializes cache and sets token if cacheInitialized is false', async (t) => {
  const token = randomId();
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient.createNewAuthToken = async () => token;
  testApiClient._validateTokenExpiry = async () => true;
  const actual = await testApiClient.getCacheAuthToken();
  t.is(token, actual);
  t.true(testApiClient.cacheInitialized);
});


test.serial('getCacheAuthToken retrieves expired token from the database and updates the database with a new token', async (t) => {
  const token = 'expiredToken';
  const updatedToken = randomId();
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient.cacheInitialized = true;
  testApiClient._updateAuthTokenRecord(token);
  testApiClient._validateTokenExpiry = async () => {
    throw new CumulusAuthTokenError('Token expired, obtaining new token');
  };
  testApiClient._createAndUpdateNewAuthToken = async () => updatedToken;

  const actual = await testApiClient.getCacheAuthToken();
  t.is(updatedToken, actual);
});

test.serial('getCacheAuthToken returns a bearer token from getAuthTokenRecord if token is not expired', async (t) => {
  const token = 'mockToken';
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient.cacheInitialized = true;
  testApiClient._getAuthTokenRecord = async () => token;
  testApiClient._validateTokenExpiry = async () => true;
  const actual = await testApiClient.getCacheAuthToken();
  t.is(token, actual);
});

test.serial('getCacheAuthToken gets a new token and updates the record if token is expired', async (t) => {
  const mockToken = 'mockToken';
  const updatedToken = randomId();
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient.cacheInitialized = true;
  testApiClient._getAuthTokenRecord = async () => mockToken;
  testApiClient._getTokenTimeLeft = async () => 0;
  testApiClient._createAndUpdateNewAuthToken = async () => updatedToken;

  testApiClient._updateAuthTokenRecord = async (token) => {
    t.is(updatedToken, token);
    return true;
  };
  const actual = await testApiClient.getCacheAuthToken();
  t.is(updatedToken, actual);
});

test.serial('getCacheAuthToken returns updated token from getAuthToken if getAuthTokenRecord throws a CumulusAuthTokenError', async (t) => {
  const updateToken = randomId();
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient.cacheInitialized = true;
  testApiClient._getAuthTokenRecord = async () => {
    throw new CumulusAuthTokenError();
  };
  testApiClient._createAndUpdateNewAuthToken = async () => updateToken;
  testApiClient._updateAuthTokenRecord = async () => true;
  const actual = await testApiClient.getCacheAuthToken();
  t.is(updateToken, actual);
});

test.serial('getCacheAuthToken throws an error if _getAuthTokenRecord throws an Error', async (t) => {
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient.cacheInitialized = true;
  testApiClient._getAuthTokenRecord = async () => {
    throw new Error('Error Message');
  };
  await t.throwsAsync(testApiClient.getCacheAuthToken());
});


test.serial('getCacheAuthToken throws an error if _validateTokenExpiry throws an Error', async (t) => {
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient.cacheInitialized = true;
  testApiClient._getAuthTokenRecord = async () => 'mockToken';
  testApiClient._validateTokenExpiry = async () => {
    throw new Error('Error Message');
  };
  await t.throwsAsync(testApiClient.getCacheAuthToken());
});

test.serial('_validateTokenExipry throws CumulusAuthTokenError if time is expired', async (t) => {
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient._getTokenTimeLeft = async () => 0;
  await t.throwsAsync(testApiClient._validateTokenExpiry(), { name: 'CumulusAuthTokenError' });
});

test.serial('_validateTokenExipry throws CumulusAuthTokenError is near expiration', async (t) => {
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient._getTokenTimeLeft = async () => 5;
  await t.throwsAsync(testApiClient._validateTokenExpiry(), { name: 'CumulusAuthTokenError' });
});

test.serial('_validateTokenExipry returns if token is valid', async (t) => {
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient._getTokenTimeLeft = async () => 50000;
  t.pass(await testApiClient._validateTokenExpiry());
});

test.serial('_getTokenTimeLeft returns time left', async (t) => {
  let decodeRevert;
  let dateRevert;
  try {
    const mockToken = 'some token value';
    decodeRevert = CumulusApiClientRewire.__set__('decode', (token) => {
      t.is(token, mockToken);
      return { exp: 1752955173 };
    });
    dateRevert = CumulusApiClientRewire.__set__('Date', { now: () => 1652955173156 });
    const testApiClient = new CumulusApiClientRewire(t.context.config);
    testApiClient._getTokenTimeLeft = async () => 50000;
    const actual = await testApiClient._getTokenTimeLeft(mockToken);
    t.is(50000, actual);
  } finally {
    decodeRevert();
    dateRevert();
  }
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

test.serial('_getAuthTokenRecord throws a CumulusAuthTokenError if decryption throws a AccessDeniedException', async (t) => {
  let decryptRevert;
  try {
    const token = `updateAndRetrieveTokenTestToken${randomId()}`;
    const testApiClient = new CumulusApiClientRewire(t.context.config);
    decryptRevert = CumulusApiClientRewire.__set__('decryptBase64String', async () => {
      const testError = new Error();
      testError.name = 'AccessDeniedException';
      throw testError;
    });
    await testApiClient._updateAuthTokenRecord(token);
    await t.throwsAsync(testApiClient._getAuthTokenRecord(), { name: 'CumulusAuthTokenError' });
  } finally {
    decryptRevert();
  }
});

test.serial('createNewAuthToken is not implemented in the base class', async (t) => {
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  await t.throwsAsync(testApiClient.createNewAuthToken());
});

test.serial('get attempts to call the url with a previous stored auth token', async (t) => {
  let gotRevert;
  try {
    const authToken = 'someAuthToken';
    gotRevert = CumulusApiClientRewire.__set__('got', {
      get: async (url, headers) => {
        t.is(`${t.context.config.baseUrl}/endpoint`, url);
        t.deepEqual({ headers: { Authorization: `Bearer ${authToken}` } }, headers);
        return 'got return value';
      }
    });
    const testApiClient = new CumulusApiClientRewire(t.context.config);
    testApiClient.cacheInitialized = true;
    testApiClient.getCacheAuthToken = async () => authToken;
    t.is('got return value', await testApiClient.get('endpoint'));
  } finally {
    gotRevert();
  }
});

test.serial('get retries/creates a token the expected number of times, then throws an error', async (t) => {
  let gotRevert;
  try {
    t.context.get_retries_counter = 0;
    const getUrl = 'http://foo.bar';
    const authToken = 'someAuthToken';
    gotRevert = CumulusApiClientRewire.__set__('got', {
      get: async (_url, _headers) => {
        t.context.get_retries_counter += 1;
        throw new Error('Access token has expired');
      }
    });
    const testApiClient = new CumulusApiClientRewire(t.context.config);
    testApiClient.cacheInitialized = true;
    testApiClient.createNewAuthToken = async () => 'mockToken';
    testApiClient.getCacheAuthToken = async () => authToken;
    await t.throwsAsync(testApiClient.get(getUrl, 4));
    t.is(t.context.get_retries_counter, 5);
  } finally {
    gotRevert();
  }
});

test.serial('_createAndUpdateNewAuthToken creates a new token and updates the cache', async (t) => {
  const token = randomId();
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient.createNewAuthToken = async () => token;
  await testApiClient._createAndUpdateNewAuthToken();

  const actual = await testApiClient._getAuthTokenRecord();
  t.is(token, actual);
});

test.serial('_createAndUpdateNewAuthToken throws a CumulusAuthTokenError on updateError', async (t) => {
  const testApiClient = new CumulusApiClientRewire(t.context.config);
  testApiClient._validateTokenExpiry = async () => true;
  testApiClient.createNewAuthToken = async () => {
    throw new Error('test error');
  };
  await t.throwsAsync(testApiClient._createAndUpdateNewAuthToken(), { name: 'CumulusAuthTokenError' });
});

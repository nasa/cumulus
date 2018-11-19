'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const {
  fakeAccessTokenFactory,
  fakeUserFactory
} = require('../../lib/testUtils');
const { RecordDoesNotExist } = require('../../lib/errors');
const { AccessToken, User } = require('../../models');

let accessTokenModel;
let userModel;
test.before(async () => {
  process.env.AccessTokensTable = randomString();
  process.env.UsersTable = randomString();

  accessTokenModel = new AccessToken();
  userModel = new User();

  await accessTokenModel.createTable();
  await userModel.createTable();
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await userModel.deleteTable();
});

test('AccessToken model sets the tableName from a param', (t) => {
  const tableName = randomString();
  const testAccessTokenModel = new AccessToken({ tableName });

  t.is(testAccessTokenModel.tableName, tableName);
});

test('AccessToken model sets the table name from the AccessTokensTable environment variable', (t) => {
  const envTableName = randomString();
  process.env.AccessTokensTable = envTableName;

  const testAccessTokenModel = new AccessToken();
  t.is(testAccessTokenModel.tableName, envTableName);
});

test('create() creates a valid access token record', async (t) => {
  const userRecord = fakeUserFactory();
  await userModel.create(userRecord);

  const accessTokenData = fakeAccessTokenFactory({ username: userRecord.userName });
  const accessTokenRecord = await accessTokenModel.create(accessTokenData);

  t.is(accessTokenRecord.accessToken, accessTokenData.accessToken);
  t.is(accessTokenRecord.refreshToken, accessTokenData.refreshToken);
  t.is(accessTokenRecord.username, userRecord.userName);
  t.truthy(accessTokenRecord.expirationTime);
});

test('get() throws error for missing record', async (t) => {
  try {
    await accessTokenModel.get({ accessToken: randomString() });
    t.fail('expected code to throw error');
  }
  catch (err) {
    t.true(err instanceof RecordDoesNotExist);
  }
});

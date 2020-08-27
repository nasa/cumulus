const test = require('ava');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noPreserveCache();

const { getRequiredEnvVar, getConnectionConfigEnv } = require('../dist/config');

const dbConnectionConfig = {
  username: 'postgres',
  password: 'password',
  database: 'postgres',
  host: 'localhost',
};

const secretsManagerStub = sinon.stub().returns({
  getSecretValue: (_value) => ({
    promise: () => Promise.resolve({
      SecretString: JSON.stringify(dbConnectionConfig),
    }),
  }),
  putSecretValue: (_value) => ({ promise: () => Promise.resolve() }),
});

const undefinedSecretsManagerStub = sinon.stub().returns({
  getSecretValue: (_value) => ({
    promise: () => Promise.resolve({
      SecretString: undefined,
    }),
  }),
  putSecretValue: (_value) => ({ promise: () => Promise.resolve() }),
});

const badSecretsManagerStub = sinon.stub().returns({
  getSecretValue: (_value) => ({
    promise: () => Promise.resolve({
      SecretString: { test: 'value' },
    }),
  }),
  putSecretValue: (_value) => ({ promise: () => Promise.resolve() }),
});

test('getRequiredEnvVar returns an environment value if defined', async (t) => {
  const result = getRequiredEnvVar('testVar', { testVar: 'testvalue' });
  t.is(result, 'testvalue');
});

test('getRequiredEnvVar throws error if not defined', async (t) => {
  t.throws(() => getRequiredEnvVar('testVar', {}));
});

test('getSecretConnectionConfig returns a Knex.PgConnectionConfig object', async (t) => {
  const { getSecretConnectionConfig } = proxyquire('../dist/config.js', {
    'aws-sdk': {
      SecretsManager: secretsManagerStub,
    },
  });
  const result = await getSecretConnectionConfig('fakeSecretId');
  const expectedConfig = {
    ...dbConnectionConfig,
    user: 'postgres',
  };
  delete expectedConfig.username;
  t.deepEqual(result, expectedConfig);
});

test('getSecretConnectionConfig throws an error on an undefined secret', async (t) => {
  const { getSecretConnectionConfig } = proxyquire('../dist/config.js', {
    'aws-sdk': {
      SecretsManager: undefinedSecretsManagerStub,
    },
  });
  await t.throwsAsync(getSecretConnectionConfig('fakeSecretId'));
});

test('getSecretConnectionConfig throws an error a secret that is missing required values', async (t) => {
  const { getSecretConnectionConfig } = proxyquire('../dist/config.js', {
    'aws-sdk': {
      SecretsManager: badSecretsManagerStub,
    },
  });
  await t.throwsAsync(getSecretConnectionConfig('fakeSecretId'));
});

test('getConnectionConfigEnv returns the expected configuration from the passed in env object', async (t) => {
  const envObject = {
    PG_HOST: 'PG_HOST',
    PG_USER: 'PG_USER',
    PG_PASSWORD: 'PG_PASSWORD',
    PG_DATABASE: 'PG_DATABASE',
  };
  const result = await getConnectionConfigEnv(envObject);
  t.deepEqual(result, {
    host: 'PG_HOST',
    user: 'PG_USER',
    password: 'PG_PASSWORD',
    database: 'PG_DATABASE',
  });
});

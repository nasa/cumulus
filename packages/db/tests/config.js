const test = require('ava');
const sinon = require('sinon');

const { getSecretConnectionConfig, getRequiredEnvVar, getConnectionConfigEnv } = require('../dist/config');

const dbConnectionConfig = {
  username: 'postgres',
  password: 'password',
  database: 'postgres',
  host: 'localhost',
};

const secretsManagerStub = {
  getSecretValue: (_value) => ({
    promise: () => Promise.resolve({
      SecretString: JSON.stringify(dbConnectionConfig),
    }),
  }),
  putSecretValue: (_value) => ({ promise: () => Promise.resolve() }),
};

const undefinedSecretsManagerStub = {
  getSecretValue: (_value) => ({
    promise: () => Promise.resolve({
      SecretString: undefined,
    }),
  }),
  putSecretValue: (_value) => ({ promise: () => Promise.resolve() }),
};

const badSecretsManagerStub = {
  getSecretValue: (_value) => ({
    promise: () => Promise.resolve({
      SecretString: { test: 'value' },
    }),
  }),
  putSecretValue: (_value) => ({ promise: () => Promise.resolve() }),
};

test('getRequiredEnvVar returns an environment value if defined', async (t) => {
  const result = getRequiredEnvVar('testVar', { testVar: 'testvalue' });
  t.is(result, 'testvalue');
});

test('getRequiredEnvVar throws error if not defined', async (t) => {
  t.throws(() => getRequiredEnvVar('testVar', {}));
});

test('getSecretConnectionConfig returns a Knex.PgConnectionConfig object', async (t) => {
  const result = await getSecretConnectionConfig(
    'fakeSecretId',
    secretsManagerStub
  );
  const expectedConfig = {
    ...dbConnectionConfig,
    user: 'postgres',
  };
  delete expectedConfig.username;
  t.deepEqual(result, expectedConfig);
});

test('getSecretConnectionConfig throws an error on an undefined secret', async (t) => {
  await t.throwsAsync(getSecretConnectionConfig(
    'fakeSecretId',
    undefinedSecretsManagerStub
  ));
});

test('getSecretConnectionConfig throws an error a secret that is missing required values', async (t) => {
  await t.throwsAsync(getSecretConnectionConfig(
    'fakeSecretId',
    badSecretsManagerStub
  ));
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

const test = require('ava');

const {
  getConnectionConfig,
  getConnectionConfigEnv,
  getSecretConnectionConfig,
  getKnexConfig,
  isKnexDebugEnabled,
} = require('../dist/config');

const dbConnectionConfig = {
  username: 'postgres',
  password: 'password',
  database: 'postgres',
  host: 'localhost',
  port: 5435,
};

const dbConnectionConfigEnv = {
  PG_HOST: 'localhost',
  PG_USER: 'postgres',
  PG_DATABASE: 'postgres',
  PG_PORT: 5435,
  PG_PASSWORD: 'password',
};

const secretsManagerStub = {
  getSecretValue: (_value) => Promise.resolve({
    SecretString: JSON.stringify(dbConnectionConfig),
  }),
  putSecretValue: (_value) => ({ promise: () => Promise.resolve() }),
};

const secretsManagerNoPortStub = {
  getSecretValue: (_value) => Promise.resolve({
    SecretString: JSON.stringify({ ...dbConnectionConfig, port: undefined }),
  }),
  putSecretValue: (_value) => ({ promise: () => Promise.resolve() }),
};

const undefinedSecretsManagerStub = {
  getSecretValue: (_value) => Promise.resolve({
    SecretString: undefined,
  }),
  putSecretValue: (_value) => ({ promise: () => Promise.resolve() }),
};

const badSecretsManagerStub = {
  getSecretValue: (_value) => Promise.resolve({
    SecretString: { test: 'value' },
  }),
  putSecretValue: (_value) => ({ promise: () => Promise.resolve() }),
};

test('getKnexConfig returns an expected default configuration object', async (t) => {
  const result = await getKnexConfig({ env: dbConnectionConfigEnv });
  const connectionConfig = { ...dbConnectionConfig, user: 'postgres' };
  delete connectionConfig.username;
  const expectedConfig = {
    acquireConnectionTimeout: 60000,
    asyncStackTraces: false,
    client: 'pg',
    connection: connectionConfig,
    debug: false,
    pool: {
      min: 0,
      max: 2,
      acquireTimeoutMillis: 90000,
      createRetryIntervalMillis: 30000,
      createTimeoutMillis: 20000,
      destroyTimeoutMillis: 5000,
      idleTimeoutMillis: 1000,
      propagateCreateError: false,
      reapIntervalMillis: 1000,
    },
  };
  t.deepEqual(result, expectedConfig);
});

test('getKnexConfig sets idleTimeoutMillis when env is set', async (t) => {
  const result = await getKnexConfig({
    env: {
      ...dbConnectionConfigEnv,
      idleTimeoutMillis: 2000,
    },
  });
  t.deepEqual(result.pool.idleTimeoutMillis, 2000);
});

test('getKnexConfig sets maxPool size when env is set', async (t) => {
  const result = await getKnexConfig({
    env: {
      ...dbConnectionConfigEnv,
      dbMaxPool: 10,
    },
  });
  t.deepEqual(result.pool.max, 10);
});

test('getKnexConfig sets createTimeoutMillis when env is set', async (t) => {
  const result = await getKnexConfig({
    env: {
      ...dbConnectionConfigEnv,
      createTimeoutMillis: 100000,
    },
  });
  t.deepEqual(result.pool.createTimeoutMillis, 100000);
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

test('getConnectionConfigEnv returns the expected configuration from the passed in env object', (t) => {
  const envObject = {
    PG_HOST: 'PG_HOST',
    PG_USER: 'PG_USER',
    PG_PASSWORD: 'PG_PASSWORD',
    PG_DATABASE: 'PG_DATABASE',
    PG_PORT: 5435,
  };
  const result = getConnectionConfigEnv(envObject);
  t.deepEqual(result, {
    host: 'PG_HOST',
    user: 'PG_USER',
    password: 'PG_PASSWORD',
    database: 'PG_DATABASE',
    port: 5435,
  });
});

test('getConnectionConfigEnv returns the expected configuration from the passed in env object with undefined port', (t) => {
  const envObject = {
    PG_HOST: 'PG_HOST',
    PG_USER: 'PG_USER',
    PG_PASSWORD: 'PG_PASSWORD',
    PG_DATABASE: 'PG_DATABASE',
  };
  const result = getConnectionConfigEnv(envObject);
  t.deepEqual(result, {
    host: 'PG_HOST',
    user: 'PG_USER',
    password: 'PG_PASSWORD',
    database: 'PG_DATABASE',
    port: 5432,
  });
});

test('getConnectionConfig returns the expected configuration when using Secrets Manager', async (t) => {
  const result = await getConnectionConfig({
    env: { databaseCredentialSecretArn: 'fakeSecretId' },
    secretsManager: secretsManagerStub,
  });

  const expectedConfig = {
    ...dbConnectionConfig,
    user: 'postgres',
  };
  delete expectedConfig.username;

  t.deepEqual(result, expectedConfig);
});

test('getConnectionConfig returns the expected configuration when using Secrets Manager with no port defined', async (t) => {
  const result = await getConnectionConfig({
    env: { databaseCredentialSecretArn: 'fakeSecretId' },
    secretsManager: secretsManagerNoPortStub
    ,
  });

  const expectedConfig = {
    ...dbConnectionConfig,
    user: 'postgres',
    port: 5432,
  };
  delete expectedConfig.username;

  t.deepEqual(result, expectedConfig);
});

test('getConnectionConfig returns the expected configuration when using environment variables', async (t) => {
  const result = await getConnectionConfig({
    env: {
      PG_HOST: 'PG_HOST',
      PG_USER: 'PG_USER',
      PG_PASSWORD: 'PG_PASSWORD',
      PG_DATABASE: 'PG_DATABASE',
      PG_PORT: 5435,
    },
  });

  t.deepEqual(
    result,
    {
      host: 'PG_HOST',
      user: 'PG_USER',
      password: 'PG_PASSWORD',
      database: 'PG_DATABASE',
      port: 5435,
    }
  );
});

test('isKnexDebugEnabled() returns true if debugging is enabled', (t) => {
  t.true(isKnexDebugEnabled({ KNEX_DEBUG: 'true' }));
});

test('isKnexDebugEnabled() returns false if debugging is not enabled', (t) => {
  t.false(isKnexDebugEnabled({ KNEX_DEBUG: 'false' }));
  t.false(isKnexDebugEnabled({ KNEX_DEBUG: 'foobar' }));
  t.false(isKnexDebugEnabled({}));
  t.false(isKnexDebugEnabled());
});

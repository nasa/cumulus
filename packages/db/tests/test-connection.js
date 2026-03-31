const test = require('ava');
const sinon = require('sinon');
const cryptoRandomString = require('crypto-random-string');
const { KnexTimeoutError } = require('knex');

const {
  getKnexClient,
  initializeKnexClientSingleton,
  getKnexClientSingleton,
  destroyKnexClientSingleton,
} = require('../dist/connection');
const { localStackConnectionEnv } = require('../dist/config');

const fakeConnectionConfig = {
  host: 'localhost',
  password: 'fakepassword',
  user: 'someuser',
  database: 'fakeDb',
  port: 5432,
};

const knexFakeError = new Error('Fake Knex Timeout Error');
knexFakeError.name = 'KnexTimeoutError';

test.before(async (t) => {
  t.context.secretsManager = {
    getSecretValue: () => Promise.resolve({
      SecretString: JSON.stringify({
        host: fakeConnectionConfig.host,
        username: fakeConnectionConfig.user,
        password: fakeConnectionConfig.password,
        database: fakeConnectionConfig.database,
      }),
    }),
  };

  t.context.knex = await getKnexClient({ env: localStackConnectionEnv });
  t.context.tableName = cryptoRandomString({ length: 10 });
  await t.context.knex.schema.createTable(t.context.tableName, (table) => {
    table.increments('cumulus_id').primary();
    table.text('info');
  });
});

test.after.always(async (t) => {
  await t.context.knex.schema.dropTable(t.context.tableName);
});

test('getKnexClient returns expected Knex object with migration defined',
  async (t) => {
    const results = await getKnexClient({
      env: {
        migrationDir: 'testMigrationDir',
        databaseCredentialSecretArn: 'randomSecret',
        KNEX_ASYNC_STACK_TRACES: 'true',
        KNEX_DEBUG: 'true',
      },
      secretsManager: t.context.secretsManager,
    });
    t.is('testMigrationDir', results.migrate.config.directory);
    t.is('knex_migrations', results.migrate.config.tableName);
    t.deepEqual(
      { ...fakeConnectionConfig, ssl: { rejectUnauthorized: true } },
      results.client.config.connection
    );
    t.is(true, results.client.config.debug);
    t.is(true, results.client.config.asyncStackTraces);
    t.is('pg', results.client.config.client);
    t.is(60000, results.client.config.acquireConnectionTimeout);
  });

test('getKnexClient returns expected Knex object with optional config defined',
  async (t) => {
    const results = await getKnexClient({
      env: {
        migrationDir: 'testMigrationDir',
        databaseCredentialSecretArn: 'randomSecret',
        KNEX_DEBUG: 'true',
        KNEX_ASYNC_STACK_TRACES: 'true',
      },
      secretsManager: t.context.secretsManager,
    });
    t.is('testMigrationDir', results.migrate.config.directory);
    t.is('knex_migrations', results.migrate.config.tableName);
  });

test('getKnexClient returns Knex object with a default migration set when env.migrations is not defined',
  async (t) => {
    const results = await getKnexClient({
      env: {
        databaseCredentialSecretArn: 'randomSecret',
      },
      secretsManager: t.context.secretsManager,
    });
    t.is('./migrations', results.migrate.config.directory);
    t.is('knex_migrations', results.migrate.config.tableName);
  });

test('getKnexClient returns expected Knex object with manual db configuration options set',
  async (t) => {
    const results = await getKnexClient({
      env: {
        migrationDir: 'testMigrationDir',
        PG_HOST: fakeConnectionConfig.host,
        PG_USER: fakeConnectionConfig.user,
        PG_PASSWORD: fakeConnectionConfig.password,
        PG_DATABASE: fakeConnectionConfig.database,
        KNEX_ASYNC_STACK_TRACES: 'true',
        KNEX_DEBUG: 'true',
      },
    });
    t.is('testMigrationDir', results.migrate.config.directory);
    t.is('knex_migrations', results.migrate.config.tableName);
    t.deepEqual(
      { ...fakeConnectionConfig, ssl: { rejectUnauthorized: true } },
      results.client.config.connection
    );
    t.is(true, results.client.config.debug);
    t.is(true, results.client.config.asyncStackTraces);
    t.is('pg', results.client.config.client);
    t.is(60000, results.client.config.acquireConnectionTimeout);
  });

test('getKnexClient logs retry errors and throws expected knexTimeoutError', async (t) => {
  const loggerWarnStub = sinon.stub();
  const knexLogger = { warn: loggerWarnStub, info: sinon.stub() };
  const knex = await getKnexClient({
    env: {
      KNEX_ASYNC_STACK_TRACES: 'true',
      KNEX_DEBUG: 'true',
      ...localStackConnectionEnv,
      PG_PORT: 5400,
      createTimeoutMillis: 1000,
      acquireTimeoutMillis: 3000,
      createRetryIntervalMillis: 500,
    },
    knexLogger,
  });
  await t.throwsAsync(
    knex(t.context.tableName).where({}),
    { instanceOf: KnexTimeoutError }
  );
  t.deepEqual(loggerWarnStub.args[0][0], 'knex failed on attempted connection');
  t.is(loggerWarnStub.args[0][1].code, 'ECONNREFUSED');
  console.log(loggerWarnStub.callCount);
  t.true(loggerWarnStub.callCount > 1);
});

test('getKnexClient returns a working knex client that throws invalid query errors as expected',
  async (t) => {
    const tableName = t.context.tableName;
    await t.context.knex(tableName).select();
    await t.throwsAsync(t.context.knex(tableName).select({ foo: 'bar' }), {
      message: `select "bar" as "foo" from "${t.context.tableName}" - column "bar" does not exist`,
    });
  });

// Singleton connection tests
test.serial('initializeKnexClientSingleton creates and reuses singleton',
  async (t) => {
    // Clean up any existing singleton
    await destroyKnexClientSingleton();

    const env = { ...localStackConnectionEnv, DEPLOY_ICEBERG_API: 'true' };

    const client1 = await initializeKnexClientSingleton({ env });
    const client2 = await initializeKnexClientSingleton({ env });

    // Should return the same instance
    t.is(client1, client2);

    await destroyKnexClientSingleton();
  });

test.serial('initializeKnexClientSingleton handles concurrent calls safely',
  async (t) => {
    // Clean up any existing singleton
    await destroyKnexClientSingleton();

    const env = { ...localStackConnectionEnv, DEPLOY_ICEBERG_API: 'true' };

    // Simulate concurrent initialization
    const [client1, client2, client3] = await Promise.all([
      initializeKnexClientSingleton({ env }),
      initializeKnexClientSingleton({ env }),
      initializeKnexClientSingleton({ env }),
    ]);

    // All should return the same instance
    t.is(client1, client2);
    t.is(client2, client3);

    await destroyKnexClientSingleton();
  });

test.serial('getKnexClientSingleton returns singleton in Iceberg API mode',
  async (t) => {
    // Clean up any existing singleton
    await destroyKnexClientSingleton();

    const env = { ...localStackConnectionEnv, DEPLOY_ICEBERG_API: 'true' };

    const client1 = await getKnexClientSingleton({ env });
    const client2 = await getKnexClientSingleton({ env });

    // Should return the same instance
    t.is(client1, client2);

    await destroyKnexClientSingleton();
  });

test.serial('getKnexClientSingleton returns new client in Lambda mode',
  async (t) => {
    // Clean up any existing singleton
    await destroyKnexClientSingleton();

    const env = { ...localStackConnectionEnv };
    // DEPLOY_ICEBERG_API not set or not 'true' = Lambda mode

    const client1 = await getKnexClientSingleton({ env });
    const client2 = await getKnexClientSingleton({ env });

    // Should return different instances in Lambda mode
    t.not(client1, client2);

    // Clean up
    await client1.destroy();
    await client2.destroy();
  });

test.serial('getKnexClientSingleton sets default pool size for Iceberg API',
  async (t) => {
    // Clean up any existing singleton
    await destroyKnexClientSingleton();

    const env = { ...localStackConnectionEnv, DEPLOY_ICEBERG_API: 'true' };

    const client = await getKnexClientSingleton({ env });

    // Check that pool max is set to 50 (default for Iceberg API)
    t.is(client.client.pool.max, 50);

    await destroyKnexClientSingleton();
  });

test.serial('getKnexClientSingleton respects custom dbMaxPool setting',
  async (t) => {
    // Clean up any existing singleton
    await destroyKnexClientSingleton();

    const env = {
      ...localStackConnectionEnv,
      DEPLOY_ICEBERG_API: 'true',
      dbMaxPool: '25',
    };

    const client = await getKnexClientSingleton({ env });

    // Check that pool max is set to custom value
    t.is(client.client.pool.max, 25);

    await destroyKnexClientSingleton();
  });

test.serial('destroyKnexClientSingleton destroys and resets singleton',
  async (t) => {
    // Clean up any existing singleton
    await destroyKnexClientSingleton();

    const env = { ...localStackConnectionEnv, DEPLOY_ICEBERG_API: 'true' };

    const client1 = await getKnexClientSingleton({ env });

    await destroyKnexClientSingleton();

    const client2 = await getKnexClientSingleton({ env });

    // Should create a new instance after destroy
    t.not(client1, client2);

    await destroyKnexClientSingleton();
  });

test.serial('failed initialization clears promise and allows retry',
  async (t) => {
    await destroyKnexClientSingleton();

    const badEnv = {
      ...localStackConnectionEnv,
      DEPLOY_ICEBERG_API: 'true',
      PG_PORT: '9999',  // Invalid port
      createTimeoutMillis: 100,
      acquireTimeoutMillis: 100,
    };

    // First attempt: initialize and immediately try a query to force connection failure
    await t.throwsAsync(async () => {
      const instance = await initializeKnexClientSingleton({ env: badEnv });
      await instance.raw('SELECT 1'); // This forces the actual connection attempt
    }, { instanceOf: KnexTimeoutError });

    // Retry with good config
    const goodEnv = { ...localStackConnectionEnv, DEPLOY_ICEBERG_API: 'true' };
    const client = await initializeKnexClientSingleton({ env: goodEnv });

    t.truthy(client);
    await destroyKnexClientSingleton();
  });
const test = require('ava');
const sinon = require('sinon');
const cryptoRandomString = require('crypto-random-string');
const { KnexTimeoutError } = require('knex');

const { getKnexClient } = require('../dist/connection');
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
  t.true(loggerWarnStub.args[0][1].errors.map((e) => e.message).includes('connect ECONNREFUSED 127.0.0.1:5400'));
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

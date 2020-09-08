const test = require('ava');
const { getKnexClient } = require('../dist/connection');

const fakeConnectionConfig = {
  host: 'localhost',
  password: 'fakepassword',
  user: 'someuser',
  database: 'fakeDb',
};

test.before(async (t) => {
  t.context.secretsManager = {
    getSecretValue: () => ({
      promise: () => Promise.resolve({
        SecretString: JSON.stringify({
          host: fakeConnectionConfig.host,
          username: fakeConnectionConfig.user,
          password: fakeConnectionConfig.password,
          database: fakeConnectionConfig.database,
        }),
      }),
    }),
  };
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
    t.deepEqual(fakeConnectionConfig, results.client.config.connection);
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

test('getKnexClient returns expected Knex object with manual db configuraiton options set',
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
    t.deepEqual(fakeConnectionConfig, results.client.config.connection);
    t.is(true, results.client.config.debug);
    t.is(true, results.client.config.asyncStackTraces);
    t.is('pg', results.client.config.client);
    t.is(60000, results.client.config.acquireConnectionTimeout);
  });

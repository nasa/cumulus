const test = require('ava');
const { knex } = require('../dist/connection');

const fakeConnectionConfig = {
  host: 'localhost',
  password: 'fakepassword',
  user: 'someuser',
  database: 'fakeDb',
};

const fakeSecretsManager = {
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

test('knex returns expected Knex object with migration defined',
  async (t) => {
    const results = await knex({
      env: {
        migrationDir: 'testMigrationDir',
        databaseCredentialSecretArn: 'randomSecret',
        KNEX_ASYNC_STACK_TRACES: 'true',
        KNEX_DEBUG: 'true',
      },
      secretsManager: fakeSecretsManager,
    });
    t.is(results.migrate.config.directory, 'testMigrationDir');
    t.is(results.migrate.config.tableName, 'knex_migrations');
    t.deepEqual(results.client.config.connection, fakeConnectionConfig);
    t.is(results.client.config.debug, true);
    t.is(results.client.config.asyncStackTraces, true);
    t.is(results.client.config.client, 'pg');
    t.is(results.client.config.acquireConnectionTimeout, 60000);
  });

test('knex returns expected Knex object with optional config defined',
  async (t) => {
    const results = await knex({
      env: {
        migrationDir: 'testMigrationDir',
        databaseCredentialSecretArn: 'randomSecret',
        KNEX_DEBUG: 'true',
        KNEX_ASYNC_STACK_TRACES: 'true',
      },
      secretsManager: fakeSecretsManager,
    });
    t.is('testMigrationDir', results.migrate.config.directory);
    t.is('knex_migrations', results.migrate.config.tableName);
  });

test('knex returns Knex object with a default migration set when env.migrations is not defined',
  async (t) => {
    const results = await knex({
      env: {
        databaseCredentialSecretArn: 'randomSecret',
      },
      secretsManager: fakeSecretsManager,
    });
    t.is('./migrations', results.migrate.config.directory);
    t.is('knex_migrations', results.migrate.config.tableName);
  });

test('knex returns expected Knex object with manual db configuraiton options set',
  async (t) => {
    const results = await knex({
      env: {
        migrationDir: 'testMigrationDir',
        PG_HOST: 'localhost',
        PG_USER: 'fakeUser',
        PG_PASSWORD: 'fakePassword',
        PG_DATABASE: 'fakeDb',
        KNEX_ASYNC_STACK_TRACES: 'true',
        KNEX_DEBUG: 'true',
      },
      secretsManager: fakeSecretsManager,
    });
    t.is('testMigrationDir', results.migrate.config.directory);
    t.is('knex_migrations', results.migrate.config.tableName);
    t.deepEqual(
      results.client.config.connection,
      {
        host: 'localhost',
        user: 'fakeUser',
        password: 'fakePassword',
        database: 'fakeDb',
      }
    );
    t.is(true, results.client.config.debug);
    t.is(true, results.client.config.asyncStackTraces);
    t.is('pg', results.client.config.client);
    t.is(60000, results.client.config.acquireConnectionTimeout);
  });

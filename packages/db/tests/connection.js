const test = require('ava');
const proxyquire = require('proxyquire').noPreserveCache();

const fakeConnectionConfig = {
  host: 'localhost',
  password: 'fakepassword',
  user: 'someuser',
  database: 'fakeDb',
};

test.before(async (t) => {
  const { knex } = proxyquire('../dist/connection.js', {
    './config': {
      getConnectionConfigEnv: () => fakeConnectionConfig,
      getSecretConnectionConfig: () => Promise.resolve(fakeConnectionConfig),
    },
  });
  t.context.knex = knex;
});

test('knex returns expected Knex object with migration defined',
  async (t) => {
    const results = await t.context.knex({
      migrationDir: 'testMigrationDir',
      databaseCredentialSecretArn: 'randomSecret',
      KNEX_ASYNC_STACK_TRACES: 'true',
      KNEX_DEBUG: 'true',
    });
    t.is('testMigrationDir', results.migrate.config.directory);
    t.is('knex_migrations', results.migrate.config.tableName);
    t.deepEqual(fakeConnectionConfig, results.client.config.connection);
    t.is(true, results.client.config.debug);
    t.is(true, results.client.config.asyncStackTraces);
    t.is('pg', results.client.config.client);
    t.is(60000, results.client.config.acquireConnectionTimeout);
  });

test('knex returns expected Knex object with optional config defined',
  async (t) => {
    const results = await t.context.knex({
      migrationDir: 'testMigrationDir',
      databaseCredentialSecretArn: 'randomSecret',
      KNEX_DEBUG: 'true',
      KNEX_ASYNC_STACK_TRACES: 'true',
    });
    t.is('testMigrationDir', results.migrate.config.directory);
    t.is('knex_migrations', results.migrate.config.tableName);
  });

test('knex returns Knex object with a default migration set when env.migrations is not defined',
  async (t) => {
    const results = await t.context.knex({
      databaseCredentialSecretArn: 'randomSecret',
    });
    t.is('./migrations', results.migrate.config.directory);
    t.is('knex_migrations', results.migrate.config.tableName);
  });

test('knex returns expected Knex object with manual db configuraiton options set',
  async (t) => {
    const results = await t.context.knex({
      migrationDir: 'testMigrationDir',
      PG_HOST: 'localhost',
      PG_USER: 'fakeUser',
      PG_PASSWORD: 'fakePassword',
      PG_DATABASE: 'fakeDb',
      KNEX_ASYNC_STACK_TRACES: 'true',
      KNEX_DEBUG: 'true',
    });
    t.is('testMigrationDir', results.migrate.config.directory);
    t.is('knex_migrations', results.migrate.config.tableName);
    t.deepEqual(fakeConnectionConfig, results.client.config.connection);
    t.is(true, results.client.config.debug);
    t.is(true, results.client.config.asyncStackTraces);
    t.is('pg', results.client.config.client);
    t.is(60000, results.client.config.acquireConnectionTimeout);
  });

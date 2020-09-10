const test = require('ava');
const sinon = require('sinon');
const { getKnexClient, queryHeartbeat } = require('../dist/connection');
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

test('getKnexClient with heartbeat check enabled and legit database returns Knex object',
  async (t) => {
    const results = await getKnexClient({
      env: {
        migrationDir: 'testMigrationDir',
        KNEX_ASYNC_STACK_TRACES: 'true',
        KNEX_DEBUG: 'true',
        ...localStackConnectionEnv,
        dbHeartBeat: 'true',
      },
    });
    const expected = {
      database: localStackConnectionEnv.PG_DATABASE,
      host: localStackConnectionEnv.PG_HOST,
      password: localStackConnectionEnv.PG_PASSWORD,
      user: localStackConnectionEnv.PG_USER,
      port: localStackConnectionEnv.PG_PORT,
    };
    t.deepEqual(expected, results.client.config.connection);
  });

test('getKnexClient with heartbeat check enabled and inalid db_config throws error',
  async (t) => {
    await t.throwsAsync(getKnexClient({
      env: {
        migrationDir: 'testMigrationDir',
        KNEX_ASYNC_STACK_TRACES: 'true',
        KNEX_DEBUG: 'true',
        ...localStackConnectionEnv,
        dbHeartBeat: 'true',
        PG_USER: 'bogus_user',
      },
    }));
  });

test.serial('queryHeartbeat retries and does not throw when KnexTimeOutError is thrown on the first attempt',
  async (t) => {
    const knexRawStub = sinon.stub();
    knexRawStub.onCall(0).throws(knexFakeError);
    knexRawStub.onCall(1).returns(Promise.resolve());
    await t.notThrowsAsync(async () => queryHeartbeat({ knex: { raw: knexRawStub } }));
  });

test.serial('queryHeartbeat throws when an error is thrown',
  async (t) => {
    const knexRawStub = sinon.stub();
    knexRawStub.onCall(0).throws(new Error('some random error'));
    knexRawStub.onCall(1).returns(Promise.resolve());
    await t.throwsAsync(async () => queryHeartbeat({ knex: { raw: knexRawStub } }));
  });

test.serial('queryHeartbeat throws when KnexTimeOutError is thrown repeatedly',
  async (t) => {
    const knexRawStub = sinon.stub();
    knexRawStub.onCall(0).throws(knexFakeError);
    knexRawStub.onCall(1).throws(knexFakeError);
    knexRawStub.onCall(2).returns(Promise.resolve());
    await t.throwsAsync(async () => queryHeartbeat({ knex: { raw: knexRawStub } }));
  });

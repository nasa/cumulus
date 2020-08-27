const test = require('ava');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noPreserveCache();

// eslint-disable-next-line unicorn/import-index
const sandbox = sinon.createSandbox();

const fakeConnectionConfig = {
  host: 'localhost',
  password: 'fakepassword',
  user: 'someuser',
  database: 'fakedbb',
};
test.afterEach(async () => {
  sandbox.restore();
});

test.before(async (t) => {
  t.context.getSecretConnectionConfigSpy = sandbox.fake.returns(fakeConnectionConfig);
  t.context.getEnvConnectionConfigSpy = sandbox.fake.returns(fakeConnectionConfig);

  const { getConnectionFromEnvironment } = proxyquire('../dist/index.js', {
    './config': {
      getEnvConnectionConfig: t.context.getEnvConnectionConfigSpy,
      getSecretConnectionConfig: t.context.getSecretConnectionConfigSpy,
    },
  });
  t.context.getConnectionFromEnvironment = getConnectionFromEnvironment;
});

test.serial('getConnectionFromEnvironment returns a Knex object with migration defined',
  async (t) => {
    const results = await t.context.getConnectionFromEnvironment({
      migrationDir: 'testMigrationDir',
      databaseCredentialSecretId: 'randomSecret',
    });
    t.is('testMigrationDir', results.migrate.config.directory);
    t.is('knex_migrations', results.migrate.config.tableName);
  });

test.serial('getConnectionFromEnvironment returns Knew object with a default migration set when env.migrations is not defined',
  async (t) => {
    const results = await t.context.getConnectionFromEnvironment({
      databaseCredentialSecretId: 'randomSecret',
    });
    t.is('./migrations', results.migrate.config.directory);
    t.is('knex_migrations', results.migrate.config.tableName);
  });

test.serial('getConnectionFromEnvironment calls getEnvConnectionConfigSpy when env.databaseCredentialSecretId is undefined',
  async (t) => {
    await t.context.getConnectionFromEnvironment({});
    t.true(t.context.getEnvConnectionConfigSpy.called);
  });

test.serial('getConnectionFromEnvironment calls getSecretConnectionConfigSpy when env.databaseCredentialSecretId is defined',
  async (t) => {
    await t.context.getConnectionFromEnvironment({
      databaseCredentialSecretId: 'randomSecret',
    });
    t.true(t.context.getSecretConnectionConfigSpy.called);
  });

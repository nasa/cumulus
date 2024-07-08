const Knex = require('knex');
const test = require('ava');

const { randomString } = require('@cumulus/common/test-utils');
const { getKnexClient, localStackConnectionEnv } = require('@cumulus/db');
const { handler } = require('../dist/lambda');

test.before(async (t) => {
  t.context.knex = await getKnexClient({ env: localStackConnectionEnv });

  t.context.secretsManager = {
    getSecretValue: () => Promise.resolve({
      SecretString: JSON.stringify({
        host: localStackConnectionEnv.PG_HOST,
        username: localStackConnectionEnv.PG_USER,
        password: localStackConnectionEnv.PG_PASSWORD,
        database: localStackConnectionEnv.PG_DATABASE,
        disableSSL: 'true',
      }),
    }),
    putSecretValue: () => ({
      promise: () => Promise.resolve(),
    }),
  };
});

test.beforeEach((t) => {
  const randomDbString = randomString(10);
  const dbUser = `${randomDbString}-${randomDbString}-test`;
  const expectedDbUser = `${randomDbString}_${randomDbString}_test`;
  t.context = {
    ...t.context,
    dbUser,
    expectedDbUser,
    testDb: `${dbUser}-db`,
    expectedTestDb: `${expectedDbUser}_db`,
    handlerEvent: {
      prefix: dbUser,
      rootLoginSecret: 'bogusSecret',
      userLoginSecret: 'bogus',
      dbPassword: 'testPassword',
      secretsManager: t.context.secretsManager,
      dbRecreation: true,
    },
  };
});

test.afterEach.always(async (t) => {
  const { knex } = t.context;

  await knex.raw(`drop database if exists "${t.context.expectedTestDb}"`);
  await knex.raw(`drop user if exists "${t.context.expectedDbUser}"`);
});

test.afterEach.always(async (t) => {
  if (t.context.testKnex) {
    await t.context.testKnex.destroy();
  }
});

test('provision user database handler database creates the expected database when dbRecreation is set to `false`', async (t) => {
  const {
    expectedDbUser,
    expectedTestDb,
    handlerEvent,
    knex,
  } = t.context;

  const event = { ...handlerEvent, dbRecreation: false };
  await handler(event);

  const userResults = await knex('pg_catalog.pg_user')
    .where(knex.raw(`usename = CAST('${expectedDbUser}' as name)`));
  const dbResults = await knex('pg_database')
    .select('datname')
    .where(knex.raw(`datname = CAST('${expectedTestDb}' as name)`));
  t.is(userResults.length, 1);
  t.is(dbResults.length, 1);
  t.is(dbResults[0].datname, `${expectedTestDb}`);
  t.is(userResults[0].usename, `${expectedDbUser}`);
});

test('provision user database handler database creates the expected database when dbRecreation is set to `true`', async (t) => {
  const {
    expectedDbUser,
    expectedTestDb,
    handlerEvent,
    knex,
  } = t.context;

  const event = { ...handlerEvent, dbRecreation: true };
  await handler(event);

  const userResults = await knex('pg_catalog.pg_user')
    .where(knex.raw(`usename = CAST('${expectedDbUser}' as name)`));
  const dbResults = await knex('pg_database')
    .select('datname')
    .where(knex.raw(`datname = CAST('${expectedTestDb}' as name)`));
  t.is(userResults.length, 1);
  t.is(dbResults.length, 1);
  t.is(dbResults[0].datname, `${expectedTestDb}`);
  t.is(userResults[0].usename, `${expectedDbUser}`);
});

test('provision user fails if invalid password string is used', async (t) => {
  await t.throwsAsync(handler({
    ...t.context.handlerEvent,
    dbPassword: 'badPassword<>$$ <>',
  }));
});

test('provision user fails if invalid user string is used', async (t) => {
  await t.throwsAsync(handler({
    ...t.context.handlerEvent,
    prefix: 'user with bad chars <>$',
  }));
});

test('provision user database handler updates the user password', async (t) => {
  const {
    expectedDbUser,
    expectedTestDb,
    handlerEvent,
  } = t.context;

  const knexConfig = {
    client: 'pg',
    connection: {
      host: 'localhost',
      user: expectedDbUser,
      password: 'testPassword',
      database: expectedTestDb,
    },
  };

  await handler(handlerEvent);
  t.context.testKnex = Knex(knexConfig);
  await t.context.testKnex.destroy();

  // Update password, then recreate the database
  handlerEvent.dbPassword = 'newPassword';
  knexConfig.connection.password = handlerEvent.dbPassword;
  await handler(handlerEvent);

  t.context.testKnex = Knex({ ...knexConfig, password: handlerEvent.dbPassword });
  const testConnection = await t.context.testKnex.raw('SELECT 1');
  t.is(testConnection.rowCount, 1);
  await t.context.testKnex.destroy();
});

test('provision user database handler does not recreate the database if it exists and event.dbRecreation is set to `false`', async (t) => {
  const {
    dbUser,
    expectedDbUser,
    expectedTestDb,
    secretsManager,
  } = t.context;

  const handlerEvent = {
    rootLoginSecret: 'bogusSecret',
    dbPassword: 'testPassword',
    prefix: dbUser,
    secretsManager,
  };
  const testTable = 'testTable';
  const knexConfig = {
    client: 'pg',
    connection: {
      host: 'localhost',
      user: expectedDbUser,
      password: 'testPassword',
      database: expectedTestDb,
    },
  };

  const tableExistsQuery = `select * from pg_tables where tablename = '${testTable}'`;
  await handler(handlerEvent);

  t.context.testKnex = Knex(knexConfig);
  await t.context.testKnex.schema.createTable(testTable, (table) => {
    table.string('name').primary();
  });
  await t.context.testKnex.destroy();

  // Validate the table exists in the created database
  t.context.testKnex = Knex(knexConfig);
  const validateCreateTable = await t.context.testKnex.raw(tableExistsQuery);
  t.is(validateCreateTable.rows[0].tablename, 'testTable');
  await t.context.testKnex.destroy();

  await handler(handlerEvent);

  t.context.testKnex = Knex(knexConfig);
  const tableQuery = await t.context.testKnex.raw(tableExistsQuery);
  await t.context.testKnex.destroy();

  t.is(tableQuery.rowCount, 1);
});

test('provision user database handler recreates the database if it exists and has an open connection', async (t) => {
  const {
    dbUser,
    expectedDbUser,
    expectedTestDb,
    secretsManager,
  } = t.context;

  const handlerEvent = {
    rootLoginSecret: 'bogusSecret',
    dbPassword: 'testPassword',
    prefix: dbUser,
    secretsManager,
    dbRecreation: true,
  };
  const testTable = 'testTable';
  const knexConfig = {
    client: 'pg',
    connection: {
      host: 'localhost',
      user: expectedDbUser,
      password: 'testPassword',
      database: expectedTestDb,
    },
  };

  const tableExistsQuery = `select * from pg_tables where tablename = '${testTable}'`;
  await handler(handlerEvent);

  t.context.testKnex = Knex(knexConfig);
  await t.context.testKnex.schema.createTable(testTable, (table) => {
    table.string('name').primary();
  });

  // Validate the table exists in the created database
  const validateCreateTable = await t.context.testKnex.raw(tableExistsQuery);
  t.is(validateCreateTable.rows[0].tablename, 'testTable');

  await handler(handlerEvent);
  await t.context.testKnex.destroy();

  t.context.testKnex = Knex(knexConfig);
  const tableQuery = await t.context.testKnex.raw(tableExistsQuery);

  await t.context.testKnex.destroy();
  t.is(tableQuery.rowCount, 0);
});

test('provision user fails if event with no username or password is passed', async (t) => {
  const {
    handlerEvent,
  } = t.context;
  delete handlerEvent.prefix;
  delete handlerEvent.dbPassword;
  await t.throwsAsync(handler(handlerEvent));
});

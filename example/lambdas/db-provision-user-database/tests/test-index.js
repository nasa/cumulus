const AWS = require('aws-sdk');
const Knex = require('knex');
const test = require('ava');
const sinon = require('sinon');

const { randomString } = require('@cumulus/common/test-utils');
const { config } = require('@cumulus/db');
const { handler } = require('../dist/lambda');

const knex = Knex({
  client: 'pg',
  connection: {
    host: 'localhost',
    user: 'postgres',
    password: 'password',
  },
});

const dbConnectionConfig = {
  user: 'postgres',
  password: 'password',
  database: 'postgres',
  host: 'localhost',
};

sinon.stub(config, 'getConnectionConfig').resolves(dbConnectionConfig);
sinon.stub(AWS, 'SecretsManager').returns({
  putSecretValue: () => ({ promise: () => Promise.resolve() }),
});

test.beforeEach(async (t) => {
  const randomDbString = randomString(10);
  const dbUser = `${randomDbString}-${randomDbString}-test`;
  const expectedDbUser = `${randomDbString}_${randomDbString}_test`;
  t.context = {
    dbUser,
    expectedDbUser,
    testDb: `${dbUser}-db`,
    expectedTestDb: `${expectedDbUser}_db`,
    handlerEvent: {
      prefix: dbUser,
      rootLoginSecret: 'bogusSecret',
      userLoginSecret: 'bogus',
      engine: 'pg',
      dbPassword: 'testPassword',
      dbClusterIdentifier: 'fake-cluster',
    },
  };
});

test.afterEach(async (t) => {
  await knex.raw(`drop database if exists "${t.context.expectedTestDb}"`);
  await knex.raw(`drop user if exists "${t.context.expectedDbUser}"`);
});

test.afterEach.always(async (t) => {
  if (t.context.testKnex) {
    await t.context.testKnex.destroy();
  }
});

test('provision user database handler database creates the expected database', async (t) => {
  const {
    expectedDbUser,
    expectedTestDb,
    handlerEvent,
  } = t.context;

  await handler(handlerEvent);

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
  let heartBeat = await t.context.testKnex.raw('SELECT 1');
  t.is(heartBeat.rowCount, 1);
  await t.context.testKnex.destroy();

  // Update password, then recreate the database
  handlerEvent.dbPassword = 'newPassword';
  knexConfig.connection.password = handlerEvent.dbPassword;
  await handler(handlerEvent);

  t.context.testKnex = Knex({ ...knexConfig, password: handlerEvent.dbPassword });
  heartBeat = await t.context.testKnex.raw('SELECT 1');
  t.is(heartBeat.rowCount, 1);
  await t.context.testKnex.destroy();
});

test('provision user database handler recreates the database if it exists and has an open connection', async (t) => {
  const dbUser = t.context.dbUser;
  const expectedDbUser = t.context.expectedDbUser;
  const expectedTestDb = t.context.expectedTestDb;
  const handlerEvent = {
    rootLoginSecret: 'bogusSecret',
    dbPassword: 'testPassword',
    prefix: dbUser,
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
  const heartBeat = await t.context.testKnex.raw('SELECT 1');
  const tableQuery = await t.context.testKnex.raw(tableExistsQuery);

  await t.context.testKnex.destroy();
  t.is(heartBeat.rowCount, 1);
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

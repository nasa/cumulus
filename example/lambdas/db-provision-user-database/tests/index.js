const Knex = require('knex');

const test = require('ava');
const proxyquire = require('proxyquire').noPreserveCache();
const sinon = require('sinon');
const { randomString } = require('@cumulus/common/test-utils');

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

const secretsManagerStub = sinon.stub().returns({
  putSecretValue: (_value) => ({ promise: () => Promise.resolve() }),
});

const { handler } = proxyquire('../dist/lambda/index.js', {
  'aws-sdk': {
    SecretsManager: secretsManagerStub,
  },
  '@cumulus/db': {
    connection: {
      knex: () => Promise.resolve(Knex({
        client: 'pg',
        connection: dbConnectionConfig,
      })),
    },
  },
});

test.beforeEach(async (t) => {
  const randomDbString = randomString(10);
  t.context.dbUser = `${randomDbString}-${randomDbString}-test`;
  t.context.expectedDbUser = `${randomDbString}_${randomDbString}_test`;
  t.context.testDb = `${t.context.dbUser}-db`;
  t.context.expectedTestDb = `${t.context.expectedDbUser}_db`;
});

test.afterEach(async (t) => {
  await knex.raw(`drop database if exists "${t.context.expectedTestDb}"`);
  await knex.raw(`drop user if exists "${t.context.expectedDbUser}"`);
});
test('provision user database handler database creates the expected database', async (t) => {
  const dbUser = t.context.dbUser;
  const expectedDbUser = t.context.expectedDbUser;
  const expectedTestDb = t.context.expectedTestDb;
  const handlerEvent = {
    rootLoginSecret: 'bogusSecret',
    dbPassword: 'testPassword',
    prefix: dbUser,
  };

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

test('provision user database handler fails if invalid password string is used', async (t) => {
  const dbUser = t.context.dbUser;
  const handlerEvent = {
    rootLoginSecret: 'bogusSecret',
    dbPassword: 'badPassword<>$$ <>',
    prefix: dbUser,
  };
  await t.throwsAsync(handler(handlerEvent));
});

test('provision user database handler fails if invalid user string is used', async (t) => {
  t.context.dbUser = 'user with bad chars <>$';
  const dbUser = t.context.dbUser;
  const handlerEvent = {
    rootLoginSecret: 'bogusSecret',
    dbPassword: 'testPassword',
    prefix: dbUser,
  };
  await t.throwsAsync(handler(handlerEvent));
});

test('provision user database handler updates the user password', async (t) => {
  try {
    const dbUser = t.context.dbUser;
    const expectedDbUser = t.context.expectedDbUser;
    const expectedTestDb = t.context.expectedTestDb;
    const handlerEvent = {
      rootLoginSecret: 'bogusSecret',
      dbPassword: 'testPassword',
      prefix: dbUser,
    };
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
    t.context.testKnex.destroy();

    // Update password, then recreate the database
    handlerEvent.dbPassword = 'newPassword';
    knexConfig.connection.password = handlerEvent.dbPassword;
    await handler(handlerEvent);

    t.context.testKnex = Knex({ ...knexConfig, password: handlerEvent.dbPassword });
    heartBeat = await t.context.testKnex.raw('SELECT 1');
    t.is(heartBeat.rowCount, 1);
    t.context.testKnex.destroy();
  } catch (error) {
    t.context.testKnex.destroy();
    throw error;
  }
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

  try {
    await handler(handlerEvent);

    t.context.testKnex = Knex(knexConfig);
    await t.context.testKnex.schema.createTable(testTable, (table) => {
      table.string('name').primary();
    });

    // Validate the table exists in the created database
    const validateCreateTable = await t.context.testKnex.raw(tableExistsQuery);
    t.is(validateCreateTable.rows[0].tablename, 'testTable');

    await handler(handlerEvent);
    t.context.testKnex.destroy();

    t.context.testKnex = Knex({ ...knexConfig, password: handlerEvent.dbPassword });
    const heartBeat = await t.context.testKnex.raw('SELECT 1');
    const tableQuery = await t.context.testKnex.raw(tableExistsQuery);

    t.context.testKnex.destroy();
    t.is(heartBeat.rowCount, 1);
    t.is(tableQuery.rowCount, 0);
  } catch (error) {
    t.context.testKnex.destroy();
    throw error;
  }
});

test('provision user database handler fails event with no username or prefix is passed', async (t) => {
  t.context.dbUser = 'user with bad chars <>$';
  const handlerEvent = {
    rootLoginSecret: 'bogusSecret',
  };
  await t.throwsAsync(handler(handlerEvent));
});

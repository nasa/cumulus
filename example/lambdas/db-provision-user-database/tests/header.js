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
  username: 'postgres',
  password: 'password',
  database: 'postgres',
  host: 'localhost',
};

const secretsManagerStub = sinon.stub().returns({
  getSecretValue: (_value) => ({
    promise: () => Promise.resolve({
      SecretString: JSON.stringify(dbConnectionConfig),
    }),
  }),
  putSecretValue: (_value) => ({ promise: () => Promise.resolve() }),
});

// eslint-disable-next-line unicorn/import-index
const { handler } = proxyquire('../dist/lambda/index.js', {
  'aws-sdk': {
    SecretsManager: secretsManagerStub,
  },
});

test.beforeEach(async (t) => {
  t.context.dbUser = randomString(20);
  t.context.testDb = `${t.context.dbUser}_db`;
});

test.afterEach(async (t) => {
  await knex.raw(`drop database if exists "${t.context.testDb}"`);
  await knex.raw(`drop user if exists "${t.context.dbUser}"`);
});
test('provision user database creates the expected database', async (t) => {
  const dbUser = t.context.dbUser;
  const testDb = t.context.testDb;
  const handlerEvent = {
    rootLoginSecret: 'bogusSecret',
    dbPassword: 'testPassword',
    prefix: dbUser,
  };

  await handler(handlerEvent);

  const userResults = await knex('pg_catalog.pg_user')
    .where(knex.raw(`usename = CAST('${dbUser}' as name)`));
  const dbResults = await knex('pg_database')
    .select('datname')
    .where(knex.raw(`datname = CAST('${testDb}' as name)`));
  t.is(userResults.length, 1);
  t.is(dbResults.length, 1);
  t.is(dbResults[0].datname, `${testDb}`);
  t.is(userResults[0].usename, `${dbUser}`);
});

test('provision user fails if invalid password string is used', async (t) => {
  const dbUser = t.context.dbUser;
  const handlerEvent = {
    rootLoginSecret: 'bogusSecret',
    dbPassword: 'badPassword<>$$ <>',
    prefix: dbUser,
  };
  await t.throwsAsync(handler(handlerEvent));
});

test('provision user fails if invalid user string is used', async (t) => {
  t.context.dbUser = 'user with bad chars <>$';
  const dbUser = t.context.dbUser;
  const handlerEvent = {
    rootLoginSecret: 'bogusSecret',
    dbPassword: 'testPassword',
    prefix: dbUser,
  };
  await t.throwsAsync(handler(handlerEvent));
});

test('provision user updates the user password if the user already exists', async (t) => {
  const dbUser = t.context.dbUser;
  const testDb = t.context.testDb;
  const handlerEvent = {
    rootLoginSecret: 'bogusSecret',
    dbPassword: 'testPassword',
    prefix: dbUser,
  };

  await handler(handlerEvent);
  handlerEvent.dbPassword = 'newPassword';
  await handler(handlerEvent);

  const testUserKnex = Knex({
    client: 'pg',
    connection: {
      host: 'localhost',
      user: dbUser,
      password: 'newPassword',
      database: testDb,
    },
  });
  const heartBeat = await testUserKnex.raw('SELECT 1');
  testUserKnex.destroy();
  t.is(heartBeat.rowCount, 1);
});

const Knex = require('knex');
const test = require('ava');

const { randomString } = require('@cumulus/common/test-utils');
const { getKnexClient, localStackConnectionEnv } = require('@cumulus/db');
const { handler } = require('../dist/lambda');

test.before(async (t) => {
  t.context.knex = await getKnexClient({ env: localStackConnectionEnv });

  t.context.secretsManager = {
    getSecretValue: () => ({
      promise: () => Promise.resolve({
        SecretString: JSON.stringify({
          host: localStackConnectionEnv.PG_HOST,
          username: localStackConnectionEnv.PG_USER,
          password: localStackConnectionEnv.PG_PASSWORD,
          database: localStackConnectionEnv.PG_DATABASE,
        }),
      }),
    }),
    putSecretValue: () => ({
      promise: () => Promise.resolve(),
    }),
  };
});

test.beforeEach(async (t) => {
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
    },
  };
});

test.afterEach.always(async (t) => {
  const { knex } = t.context;

  await knex.raw(`drop database if exists "${t.context.expectedTestDb}"`);
  await knex.raw(`drop user if exists "${t.context.expectedDbUser}"`);
});

test('provision user database creates the expected database', async (t) => {
  const {
    expectedDbUser,
    expectedTestDb,
    handlerEvent,
    knex,
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

test('provision user updates the user password if the user already exists', async (t) => {
  const {
    expectedDbUser,
    expectedTestDb,
    handlerEvent,
  } = t.context;

  await handler(handlerEvent);
  handlerEvent.dbPassword = 'newPassword';
  await handler(handlerEvent);

  const testUserKnex = Knex({
    client: 'pg',
    connection: {
      host: 'localhost',
      user: expectedDbUser,
      password: 'newPassword',
      database: expectedTestDb,
    },
  });
  const heartBeat = await testUserKnex.raw('SELECT 1');
  testUserKnex.destroy();
  t.is(heartBeat.rowCount, 1);
});

test('provision user fails if event with no username or password is passed', async (t) => {
  const {
    handlerEvent,
  } = t.context;
  delete handlerEvent.prefix;
  delete handlerEvent.dbPassword;
  await t.throwsAsync(handler(handlerEvent));
});

import AWS from 'aws-sdk';
import Knex from 'knex';
import anyTest, { TestInterface } from 'ava';
import sinon from 'sinon';

import { randomString } from '@cumulus/common/test-utils';
import { connection } from '@cumulus/db';
import { handler } from '../src';

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

sinon.stub(connection, 'getConnectionConfig').resolves(dbConnectionConfig);
sinon.stub(AWS, 'SecretsManager').returns({
  putSecretValue: () => ({ promise: () => Promise.resolve() }),
});

// Typing t.context
const test = anyTest as TestInterface<{
  dbUser: string
  expectedDbUser: string
  testDb: string
  expectedTestDb: string
}>;

test.beforeEach(async (t) => {
  const randomDbString = randomString(10);
  const dbUser = `${randomDbString}-${randomDbString}-test`;
  const expectedDbUser = `${randomDbString}_${randomDbString}_test`;
  t.context = {
    dbUser,
    expectedDbUser,
    testDb: `${dbUser}-db`,
    expectedTestDb: `${expectedDbUser}_db`,
  };
});

test.afterEach(async (t) => {
  await knex.raw(`drop database if exists "${t.context.expectedTestDb}"`);
  await knex.raw(`drop user if exists "${t.context.expectedDbUser}"`);
});

test('provision user database creates the expected database', async (t) => {
  const dbUser = t.context.dbUser;
  const expectedDbUser = t.context.expectedDbUser;
  const expectedTestDb = t.context.expectedTestDb;
  const handlerEvent = {
    rootLoginSecret: 'bogusSecret',
    userLoginSecret: 'bogus',
    engine: 'pg',
    dbPassword: 'testPassword',
    dbClusterIdentifier: 'fake-cluster',
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

// test('provision user fails if invalid password string is used', async (t) => {
//   const dbUser = t.context.dbUser;
//   const handlerEvent = {
//     rootLoginSecret: 'bogusSecret',
//     dbPassword: 'badPassword<>$$ <>',
//     prefix: dbUser,
//   };
//   await t.throwsAsync(handler(handlerEvent));
// });

// test('provision user fails if invalid user string is used', async (t) => {
//   t.context.dbUser = 'user with bad chars <>$';
//   const dbUser = t.context.dbUser;
//   const handlerEvent = {
//     rootLoginSecret: 'bogusSecret',
//     dbPassword: 'testPassword',
//     prefix: dbUser,
//   };
//   await t.throwsAsync(handler(handlerEvent));
// });

// test('provision user updates the user password if the user already exists', async (t) => {
//   const dbUser = t.context.dbUser;
//   const expectedDbUser = t.context.expectedDbUser;
//   const expectedTestDb = t.context.expectedTestDb;
//   const handlerEvent = {
//     rootLoginSecret: 'bogusSecret',
//     dbPassword: 'testPassword',
//     prefix: dbUser,
//   };

//   await handler(handlerEvent);
//   handlerEvent.dbPassword = 'newPassword';
//   await handler(handlerEvent);

//   const testUserKnex = Knex({
//     client: 'pg',
//     connection: {
//       host: 'localhost',
//       user: expectedDbUser,
//       password: 'newPassword',
//       database: expectedTestDb,
//     },
//   });
//   const heartBeat = await testUserKnex.raw('SELECT 1');
//   testUserKnex.destroy();
//   t.is(heartBeat.rowCount, 1);
// });

// test('provision user fails event with no username or prefix is passed', async (t) => {
//   t.context.dbUser = 'user with bad chars <>$';
//   const handlerEvent = {
//     rootLoginSecret: 'bogusSecret',
//   };
//   await t.throwsAsync(handler(handlerEvent));
// });

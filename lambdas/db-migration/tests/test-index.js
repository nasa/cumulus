const test = require('ava');
const Knex = require('knex');
const cryptoRandomString = require('crypto-random-string');

const { handler } = require('../dist/lambda');

const knex = Knex({
  client: 'pg',
  connection: {
    host: 'localhost',
    user: 'postgres',
    password: 'password',
    database: 'postgres',
  },
});

test.before(async () => {
  await handler({
    env: {
      KNEX_ASYNC_STACK_TRACES: 'false',
      KNEX_DEBUG: 'false',
      PG_HOST: 'localhost',
      PG_USER: 'postgres',
      PG_PASSWORD: 'password',
      PG_DATABASE: 'postgres',
    },
  });
});

test.after.always(async () => {
  await knex.destroy();
});

test('collections table enforces unique constraint on name/version', async (t) => {
  const name = cryptoRandomString({ length: 10 });

  await knex('collections').insert({
    name,
    version: '1',
  });

  await t.throwsAsync(knex('collections').insert({
    name,
    version: '1',
  }));
});

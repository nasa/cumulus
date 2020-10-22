const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { localStackConnectionEnv } = require('../dist/config');
const { getKnexClient } = require('../dist/connection');
const {
  getDbClient,
  doesExecutionExist,
} = require('../dist/Executions');

test.before(async (t) => {
  t.context.knex = await getKnexClient({
    env: localStackConnectionEnv,
  });
  t.context.executionDbClient = getDbClient(t.context.knex);
});

test('doesExecutionExist correctly returns true', async (t) => {
  const { executionDbClient, knex } = t.context;
  const arn = `machine:${cryptoRandomString({ length: 5 })}`;
  await executionDbClient.insert({ arn });
  t.true(await doesExecutionExist({ arn }, knex));
});

test('doesExecutionExist correctly returns false', async (t) => {
  const { knex } = t.context;
  const arn = `machine:${cryptoRandomString({ length: 5 })}`;
  t.false(await doesExecutionExist({ arn }, knex));
});

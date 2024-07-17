'use strict';

const test = require('ava');
const moment = require('moment');
const clone = require('lodash/clone');
const {
  fakeExecutionRecordFactory,
  ExecutionPgModel,
  generateLocalTestDb,
  destroyLocalTestDb,
  migrationDir,
  localStackConnectionEnv,
  getKnexClient,
} = require('@cumulus/db');
const { randomId } = require('@cumulus/common/test-utils');
const {
  cleanupExpiredPGExecutionPayloads,
  getExpirationDate,
} = require('../../lambdas/cleanExecutions');

test.beforeEach(async (t) => {
  t.context.testDbName = randomId('cleanExecutions');
  const { knex, knexAdmin } = await generateLocalTestDb(t.context.testDbName, migrationDir);

  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
});
test.afterEach.always(async (t) => {
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    tesetDbName: t.context.testDbName,
  });
});

const pgPayloadsEmpty = (entry) => !entry.final_payload && !entry.orginal_payload;

test.serial('cleanupExpiredPGExecutionPayloads() cleans up expired running payloads', async (t) => {
  const env = clone(process.env);
  process.env = localStackConnectionEnv;
  process.env.PG_DATABASE = t.context.testDbName;
  const expirationDays = 3;

  const records = [];
  for (let i = 0; i < 10; i += 1) {
    records.push(fakeExecutionRecordFactory({
      updated_at: moment().subtract(i, 'days').toDate(),
      final_payload: '{"a": "b"}',
      original_payload: '{"b": "c"}',
      status: 'completed',
    }));
    records.push(fakeExecutionRecordFactory({
      updated_at: moment().subtract(i, 'days').toDate(),
      final_payload: '{"a": "b"}',
      original_payload: '{"b": "c"}',
      status: 'running',
    }));
  }
  const knex = await getKnexClient();
  const model = new ExecutionPgModel();
  const cumulusIds = await model.insert(knex, records, 'cumulus_id');

  await cleanupExpiredPGExecutionPayloads(
    expirationDays,
    true,
    false,
    100,
    1200
  );

  const massagedPgExecutions = await Promise.all(
    cumulusIds.map(
      async (cumulusId) => await model.get(knex, cumulusId)
    )
  );

  const expiration = getExpirationDate(expirationDays);

  massagedPgExecutions.forEach((massagedExecution) => {
    if (massagedExecution.updated_at < expiration && massagedExecution.status === 'running') {
      t.true(pgPayloadsEmpty(massagedExecution));
    } else {
      t.false(pgPayloadsEmpty(massagedExecution));
    }
  });
  process.env = env;
});

test.serial('cleanupExpiredPGExecutionPayloads() cleans up expired non running payloads', async (t) => {
  const env = clone(process.env);
  process.env = localStackConnectionEnv;
  process.env.PG_DATABASE = t.context.testDbName;
  const expirationDays = 6;

  const records = [];
  for (let i = 0; i < 10; i += 1) {
    records.push(fakeExecutionRecordFactory({
      updated_at: moment().subtract(i, 'days').toDate(),
      final_payload: '{"a": "b"}',
      original_payload: '{"b": "c"}',
      status: 'completed',
    }));
    records.push(fakeExecutionRecordFactory({
      updated_at: moment().subtract(i, 'days').toDate(),
      final_payload: '{"a": "b"}',
      original_payload: '{"b": "c"}',
      status: 'running',
    }));
  }
  const knex = await getKnexClient();
  const model = new ExecutionPgModel();
  const cumulusIds = await model.insert(knex, records, 'cumulus_id');

  await cleanupExpiredPGExecutionPayloads(
    expirationDays,
    false,
    true,
    100,
    15,
  );

  const massagedPgExecutions = await Promise.all(
    cumulusIds.map(
      async (cumulusId) => await model.get(knex, cumulusId)
    )
  );

  const expiration = getExpirationDate(expirationDays);
  massagedPgExecutions.forEach((massagedExecution) => {
    if (massagedExecution.updated_at < expiration && massagedExecution.status !== 'running') {
      t.true(pgPayloadsEmpty(massagedExecution));
    } else {
      t.false(pgPayloadsEmpty(massagedExecution));
    }
  });
  process.env = env;
});

test.serial('cleanupExpiredPGExecutionPayloads() cleans up expired payloads', async (t) => {
  const env = clone(process.env);
  process.env = localStackConnectionEnv;
  process.env.PG_DATABASE = t.context.testDbName;
  const expirationDays = 6;

  const records = [];
  for (let i = 0; i < 10; i += 1) {
    records.push(fakeExecutionRecordFactory({
      updated_at: moment().subtract(i, 'days').toDate(),
      final_payload: '{"a": "b"}',
      original_payload: '{"b": "c"}',
      status: 'completed',
    }));
    records.push(fakeExecutionRecordFactory({
      updated_at: moment().subtract(i, 'days').toDate(),
      final_payload: '{"a": "b"}',
      original_payload: '{"b": "c"}',
      status: 'running',
    }));
  }
  const knex = await getKnexClient();
  const model = new ExecutionPgModel();
  const cumulusIds = await model.insert(knex, records, 'cumulus_id');

  await cleanupExpiredPGExecutionPayloads(
    expirationDays,
    true,
    true,
    100,
    12
  );

  const massagedPgExecutions = await Promise.all(
    cumulusIds.map(
      async (cumulusId) => await model.get(knex, cumulusId)
    )
  );

  const expiration = getExpirationDate(expirationDays);
  massagedPgExecutions.forEach((massagedExecution) => {
    if (massagedExecution.updated_at < expiration) {
      t.true(pgPayloadsEmpty(massagedExecution));
    } else {
      t.false(pgPayloadsEmpty(massagedExecution));
    }
  });
  process.env = env;
});

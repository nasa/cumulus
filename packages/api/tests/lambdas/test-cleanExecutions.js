'use strict';

const test = require('ava');
const moment = require('moment');
const clone = require('lodash/clone');
const {
  handler,
  getExpirationDates,
  getExpirablePayloadRecords,
  cleanupExpiredExecutionPayloads,
} = require('../../lambdas/cleanExecutions');
const {
  fakeExecutionRecordFactory,
  ExecutionPgModel,
  generateLocalTestDb,
  destroyLocalTestDb,
  migrationDir,
  localStackConnectionEnv
} = require('@cumulus/db');

const { randomId } = require('@cumulus/common/test-utils');
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
//this may not really be ready after some edits
test('getExpirationDates() yields expected fields when called with a mix of complete and noncomplete', (t) => {
  let expirations = getExpirationDates(
    1, 1,
    true,
    true,
  )
  t.true('laterExpiration' in expirations);
  t.true('completeExpiration' in expirations);
  t.true('nonCompleteExpiration' in expirations);

  expirations = getExpirationDates(
    1, 1,
    false,
    true,
  )
  t.true('laterExpiration' in expirations);
  t.true('completeExpiration' in expirations);
  t.true('nonCompleteExpiration' in expirations);
})

test('getExpirablePayloadRecords()', async (t) => {

  const executions = [
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(10, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(15, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(2, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(23, 'days').toDate(),
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(10, 'days').toDate(),
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      original_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(15, 'days').toDate(),
      original_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(2, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(23, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(10, 'days').toDate(),
      original_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(15, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(2, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),

  ]
  const model = new ExecutionPgModel();
  const inserted = await model.insert(t.context.knex, executions, '*');
  let expirable = await getExpirablePayloadRecords(t.context.knex, moment().subtract(10, 'days').toDate(), 100);
  let expected = [
    inserted[0],
    inserted[2],
    inserted[7],
    inserted[9],
    inserted[10],
    inserted[12],
  ]
  
  t.deepEqual(expected, expirable)
  expirable = await getExpirablePayloadRecords(t.context.knex, moment().subtract(0, 'days').toDate(), 100);
  expected = [
    inserted[0],
    inserted[1],
    inserted[2],
    inserted[3],
    inserted[6],
    inserted[7],
    inserted[8],
    inserted[9],
    inserted[10],
    inserted[12],
    inserted[13],
  ]
  t.deepEqual(expected, expirable);

  expirable = await getExpirablePayloadRecords(t.context.knex, moment().subtract(3, 'days').toDate(), 100);
  expected = [
    inserted[0],
    inserted[1],
    inserted[2],
    inserted[6],
    inserted[7],
    inserted[9],
    inserted[10],
    inserted[12],
  ]
  t.deepEqual(expected, expirable);
});

const payloadsEmpty = (entry, t) => {
  t.false(Boolean(entry.final_payload));
  t.false(Boolean(entry.orginal_payload));
  return true;
}

test.serial('handler() clears payloads on expected executions', async (t) => {

  const env = clone(process.env);
  process.env = localStackConnectionEnv;
  process.env.PG_DATABASE = t.context.testDbName;
  const executions = [
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(10, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(15, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(2, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(23, 'days').toDate(),
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(10, 'days').toDate(),
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      original_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(15, 'days').toDate(),
      original_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(2, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(23, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(10, 'days').toDate(),
      original_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(15, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(2, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
  ]
  const model = new ExecutionPgModel();
  const inserted = await model.insert(t.context.knex, executions, 'cumulus_id');
  process.env.nonCompleteExecutionPayloadTimeout = 15;
  await handler();

  const massagedExecutions = await Promise.all(inserted.map(async (execution) => await model.get(t.context.knex, execution)));
  t.true(payloadsEmpty(massagedExecutions[2], t));
  t.true(payloadsEmpty(massagedExecutions[4], t));
  t.true(payloadsEmpty(massagedExecutions[7], t));
  t.true(payloadsEmpty(massagedExecutions[9], t));
  t.true(payloadsEmpty(massagedExecutions[12], t));
  process.env = env;
});

test.serial('cleanupExpiredExecutionPayloads() iterates through batches', async (t) => {

  const env = clone(process.env);
  process.env = localStackConnectionEnv;
  process.env.PG_DATABASE = t.context.testDbName;
  const executions = [
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
  ]
  const model = new ExecutionPgModel();
  const inserted = await model.insert(t.context.knex, executions, 'cumulus_id');
  process.env.nonCompleteExecutionPayloadTimeout = 4;
  process.env.UPDATE_LIMIT = 2
  await cleanupExpiredExecutionPayloads(4, 4, true, true);

  let massagedExecutions = await Promise.all(inserted.map(async (execution) => await model.get(t.context.knex, execution)));
  let cleanedUp = 0;
  massagedExecutions.forEach((massagedExecution) => {
    if (!(massagedExecution.original_payload || massagedExecution.final_payload)) {
      cleanedUp += 1;
    }
  });
  t.is(cleanedUp, 2)
  await cleanupExpiredExecutionPayloads(4, 4, true, true);
  massagedExecutions = await Promise.all(inserted.map(async (execution) => await model.get(t.context.knex, execution)));
  cleanedUp = 0;
  massagedExecutions.forEach((massagedExecution) => {
    if (!(massagedExecution.original_payload || massagedExecution.final_payload)) {
      cleanedUp += 1;
    }
  });
  t.is(cleanedUp, 4)
  await handler();
  massagedExecutions = await Promise.all(inserted.map(async (execution) => await model.get(t.context.knex, execution)));
  cleanedUp = 0;
  massagedExecutions.forEach((massagedExecution) => {
    if (!(massagedExecution.original_payload || massagedExecution.final_payload)) {
      cleanedUp += 1;
    }
  });
  t.is(cleanedUp, 6)
  process.env = env;
});




test.serial('handler() iterates through batch', async (t) => {

  const env = clone(process.env);
  process.env = localStackConnectionEnv;
  process.env.PG_DATABASE = t.context.testDbName;
  const executions = [
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: '{"a": "b"}',
      status: 'completed'
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: '{"a": "b"}',
      status: 'completed'
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: '{"a": "b"}',
      status: 'completed'
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: '{"a": "b"}',
      status: 'completed'
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
    fakeExecutionRecordFactory({
      updated_at: moment().subtract(5, 'days').toDate(),
      final_payload: '{"a": "b"}',
    }),
  ]
  const model = new ExecutionPgModel();
  const inserted = await model.insert(t.context.knex, executions, 'cumulus_id');
  process.env.completeExecutionPayloadTimeoutDisable = 'true';
  process.env.nonCompleteExecutionPayloadTimeout = 4;
  await handler();

  let massagedExecutions = await Promise.all(inserted.map(async (execution) => await model.get(t.context.knex, execution)));
  let cleanedUp = 0;
  massagedExecutions.forEach((massagedExecution) => {
    if (!(massagedExecution.original_payload || massagedExecution.final_payload)) {
      cleanedUp += 1;
    }
  });
  t.is(cleanedUp, 5)
  process.env.completeExecutionPayloadTimeoutDisable = 'false';
  process.env.nonCompleteExecutionPayloadTimeoutDisable = 'true';

  process.env.completeExecutionPayloadTimeout = 4;
  await handler();
  massagedExecutions = await Promise.all(inserted.map(async (execution) => await model.get(t.context.knex, execution)));
  massagedExecutions.forEach((massagedExecution) => {
    if (massagedExecution.original_payload || massagedExecution.final_payload) {
      t.fail();
    }
  });
  process.env = env;
});

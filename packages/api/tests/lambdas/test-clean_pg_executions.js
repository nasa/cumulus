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
  getExpirablePayloadRecords,
  cleanupExpiredPGExecutionPayloads,
  getExpirationDates,
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
  ];
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
  ];

  t.deepEqual(expected, expirable);
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
  ];
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
  ];
  t.deepEqual(expected, expirable);
});
const pgPayloadsEmpty = (entry) => !entry.final_payload && !entry.orginal_payload;

test('cleanupExpiredPGExecutionPayloads() cleans up expired payloads', async (t) => {
  const env = clone(process.env);
  process.env = localStackConnectionEnv;
  process.env.PG_DATABASE = t.context.testDbName;
  const completeExpirationDays = 3;
  const nonCompleteExpirationDays = 5;

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
      status: 'failed',
    }));
  }
  const knex = await getKnexClient();
  const model = new ExecutionPgModel();
  const cumulusIds = await model.insert(knex, records, 'cumulus_id');

  await cleanupExpiredPGExecutionPayloads(
    completeExpirationDays,
    nonCompleteExpirationDays,
    true,
    true
  );

  const massagedPgExecutions = await Promise.all(
    cumulusIds.map(
      async (cumulusId) => await model.get(knex, cumulusId)
    )
  );

  const {
    completeExpiration,
    nonCompleteExpiration,
  } = getExpirationDates(
    completeExpirationDays,
    nonCompleteExpirationDays,
    true,
    true
  );

  massagedPgExecutions.forEach((massagedExecution) => {
    if (massagedExecution.updated_at < completeExpiration && massagedExecution.status === 'completed') {
      t.true(pgPayloadsEmpty(massagedExecution));
    } else if (massagedExecution.updated_at < nonCompleteExpiration && massagedExecution.status !== 'completed') {
      t.true(pgPayloadsEmpty(massagedExecution));
    } else {
      t.false(pgPayloadsEmpty(massagedExecution));
    }
  });
  process.env = env;
});

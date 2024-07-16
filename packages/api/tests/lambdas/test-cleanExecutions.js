/* eslint-disable no-await-in-loop */
const test = require('ava');
const moment = require('moment');
const clone = require('lodash/clone');
const { randomId } = require('@cumulus/common/test-utils');
const {
  translatePostgresExecutionToApiExecution,
  fakeExecutionRecordFactory,
  destroyLocalTestDb,
  generateLocalTestDb,
  ExecutionPgModel,
  migrationDir,
  localStackConnectionEnv,
} = require('@cumulus/db');
const { cleanupTestIndex, createTestIndex } = require('@cumulus/es-client/testUtils');
const { sleep } = require('@cumulus/common');
const { handler, getExpirationDate } = require('../../lambdas/cleanExecutions');
test.beforeEach(async (t) => {
  t.context.testDbName = randomId('cleanExecutions');
  const { knex, knexAdmin } = await generateLocalTestDb(t.context.testDbName, migrationDir);

  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
  const { esIndex, esClient, searchClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.searchClient = searchClient;
  const records = [];
  for (let i = 0; i < 10; i += 1) {
    records.push(fakeExecutionRecordFactory({
      updated_at: moment().subtract(i, 'days').toDate(),
      final_payload: '{"a": "b"}',
      original_payload: '{"b": "c"}',
      status: 'running',
    }));
    records.push(fakeExecutionRecordFactory({
      updated_at: moment().subtract(i, 'days').toDate(),
      final_payload: '{"a": "b"}',
      original_payload: '{"b": "c"}',
      status: 'failed',
    }));
  }
  const model = new ExecutionPgModel();

  const pgRecords = await model.insert(t.context.knex, records, '*');
  for (const record of pgRecords) {
    await t.context.esClient.client.index({
      body: await translatePostgresExecutionToApiExecution(record),
      id: record.cumulus_id,
      index: t.context.esIndex,
      type: 'execution',
      refresh: true,
    });
  }
  t.context.execution_cumulus_ids = pgRecords.map((record) => record.cumulus_id);
});

test.afterEach.always(async (t) => {
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    tesetDbName: t.context.testDbName,
  });
  await cleanupTestIndex(t.context);
});

const pgPayloadsEmpty = (entry) => !entry.final_payload && !entry.orginal_payload;

const esPayloadsEmpty = (entry) => !entry.finalPayload && !entry.orginalPayload;

test.serial('handler() handles running expiration', async (t) => {
  const env = clone(process.env);
  process.env = localStackConnectionEnv;
  process.env.PG_DATABASE = t.context.testDbName;
  process.env.ES_INDEX = t.context.esIndex;
  process.env.LOCAL_ES_HOST = 'localhost';
  let expirationDays = 4;
  let expirationDate = getExpirationDate(expirationDays);
  process.env.CLEANUP_NON_RUNNING = 'false';
  process.env.CLEANUP_RUNNING = 'true';
  process.env.CLEANUP_POSTGRES = 'true';
  process.env.CLEANUP_ES = 'true';
  process.env.PAYLOAD_TIMEOUT = expirationDays;

  await handler();
   
  const model = new ExecutionPgModel();
  let massagedPgExecutions = await Promise.all(
    t.context.execution_cumulus_ids.map(
      async (cumulusId) => await model.get(t.context.knex, { cumulus_id: cumulusId })
    )
  );
  massagedPgExecutions.forEach((massagedExecution) => {
    if (massagedExecution.updated_at <= expirationDate && massagedExecution.status === 'running') {
      t.true(pgPayloadsEmpty(massagedExecution));
    } else {
      t.false(pgPayloadsEmpty(massagedExecution));
    }
  });
  let massagedEsExecutions = await t.context.searchClient.query({
    index: t.context.esIndex,
    type: 'execution',
    body: {},
    size: 30,
  });
  massagedEsExecutions.results.forEach((massagedExecution) => {
    if (massagedExecution.updatedAt <= expirationDate && massagedExecution.status === 'running') {
      t.true(esPayloadsEmpty(massagedExecution));
    } else {
      t.false(esPayloadsEmpty(massagedExecution));
    }
  });

  expirationDays = 2;
  expirationDate = getExpirationDate(expirationDays);
  process.env.PAYLOAD_TIMEOUT = expirationDays;

  await handler();
   
  massagedPgExecutions = await Promise.all(
    t.context.execution_cumulus_ids.map(
      async (cumulusId) => await model.get(t.context.knex, { cumulus_id: cumulusId })
    )
  );
  massagedPgExecutions.forEach((massagedExecution) => {
    if (massagedExecution.updated_at <= expirationDate && massagedExecution.status === 'running') {
      t.true(pgPayloadsEmpty(massagedExecution));
    } else {
      t.false(pgPayloadsEmpty(massagedExecution));
    }
  });
  massagedEsExecutions = await t.context.searchClient.query({
    index: t.context.esIndex,
    type: 'execution',
    body: {},
    size: 30,
  });
  massagedEsExecutions.results.forEach((massagedExecution) => {
    if (massagedExecution.updatedAt <= expirationDate.getTime() && massagedExecution.status === 'running') {
      t.true(esPayloadsEmpty(massagedExecution));
    } else {
      t.false(esPayloadsEmpty(massagedExecution));
    }
  });
  process.env = env;
});

test.serial('handler() handles non running expiration', async (t) => {
  const env = clone(process.env);
  process.env = localStackConnectionEnv;
  process.env.PG_DATABASE = t.context.testDbName;
  process.env.ES_INDEX = t.context.esIndex;
  let expirationDays = 5;
  let expirationDate = getExpirationDate(expirationDays);
  process.env.CLEANUP_NON_RUNNING = 'true';
  process.env.CLEANUP_RUNNING = 'false';
  process.env.CLEANUP_POSTGRES = 'true';
  process.env.CLEANUP_ES = 'true';
  process.env.PAYLOAD_TIMEOUT = expirationDays;
  await handler();
   
  const model = new ExecutionPgModel();
  let massagedPgExecutions = await Promise.all(
    t.context.execution_cumulus_ids.map(
      async (cumulusId) => await model.get(t.context.knex, { cumulus_id: cumulusId })
    )
  );
  massagedPgExecutions.forEach((massagedExecution) => {
    if (massagedExecution.updated_at <= expirationDate && massagedExecution.status !== 'running') {
      t.true(pgPayloadsEmpty(massagedExecution));
    } else {
      t.false(pgPayloadsEmpty(massagedExecution));
    }
  });
  let massagedEsExecutions = await t.context.searchClient.query({
    index: t.context.esIndex,
    type: 'execution',
    body: {},
    size: 30,
  });

  massagedEsExecutions.results.forEach((massagedExecution) => {
    if (massagedExecution.updatedAt <= expirationDate && massagedExecution.status !== 'running') {
      t.true(esPayloadsEmpty(massagedExecution));
    } else {
      t.false(esPayloadsEmpty(massagedExecution));
    }
  });

  expirationDays = 3;
  expirationDate = getExpirationDate(expirationDays);
  process.env.PAYLOAD_TIMEOUT = expirationDays;

  await handler();
   
  massagedPgExecutions = await Promise.all(
    t.context.execution_cumulus_ids.map(
      async (cumulusId) => await model.get(t.context.knex, { cumulus_id: cumulusId })
    )
  );
  massagedPgExecutions.forEach((massagedExecution) => {
    if (massagedExecution.updated_at <= expirationDate && massagedExecution.status !== 'running') {
      t.true(pgPayloadsEmpty(massagedExecution));
    } else {
      t.false(pgPayloadsEmpty(massagedExecution));
    }
  });
  massagedEsExecutions = await t.context.searchClient.query({
    index: t.context.esIndex,
    type: 'execution',
    body: {},
    size: 30,
  });
  massagedEsExecutions.results.forEach((massagedExecution) => {
    if (massagedExecution.updatedAt <= expirationDate.getTime() && massagedExecution.status !== 'running') {
      t.true(esPayloadsEmpty(massagedExecution));
    } else {
      t.false(esPayloadsEmpty(massagedExecution));
    }
  });
  process.env = env;
});

test.serial('handler() handles both expirations', async (t) => {
  const env = clone(process.env);
  process.env = localStackConnectionEnv;
  process.env.PG_DATABASE = t.context.testDbName;
  process.env.ES_INDEX = t.context.esIndex;
  process.env.LOCAL_ES_HOST = 'localhost';
  let payloadTimeout = 9;
  let payloadExpiration = getExpirationDate(payloadTimeout);

  process.env.CLEANUP_RUNNING = 'true';
  process.env.CLEANUP_NON_RUNNING = 'true';
  process.env.PAYLOAD_TIMEOUT = payloadTimeout;
  process.env.CLEANUP_POSTGRES = 'true';
  process.env.CLEANUP_ES = 'true';

  await handler();
   
  const model = new ExecutionPgModel();
  let massagedPgExecutions = await Promise.all(
    t.context.execution_cumulus_ids.map(
      async (cumulusId) => await model.get(t.context.knex, { cumulus_id: cumulusId })
    )
  );

  massagedPgExecutions.forEach((massagedExecution) => {
    if (massagedExecution.updated_at <= payloadExpiration) {
      t.true(pgPayloadsEmpty(massagedExecution));
    } else {
      t.false(pgPayloadsEmpty(massagedExecution));
    }
  });
  let massagedEsExecutions = await t.context.searchClient.query({
    index: t.context.esIndex,
    type: 'execution',
    body: {},
    size: 30,
  });
  massagedEsExecutions.results.forEach((massagedExecution) => {
    if (massagedExecution.updatedAt <= payloadExpiration.getTime()) {
      t.true(esPayloadsEmpty(massagedExecution));
    } else {
      t.false(esPayloadsEmpty(massagedExecution));
    }
  });
  payloadTimeout = 8;

  payloadExpiration = getExpirationDate(payloadTimeout);
  process.env.PAYLOAD_TIMEOUT = payloadTimeout;

  await handler();
   
  massagedPgExecutions = await Promise.all(
    t.context.execution_cumulus_ids.map(
      async (cumulusId) => await model.get(t.context.knex, { cumulus_id: cumulusId })
    )
  );

  massagedPgExecutions.forEach((massagedExecution) => {
    if (massagedExecution.updated_at <= payloadExpiration) {
      t.true(pgPayloadsEmpty(massagedExecution));
    } else {
      t.false(pgPayloadsEmpty(massagedExecution));
    }
  });
  massagedEsExecutions = await t.context.searchClient.query({
    index: t.context.esIndex,
    type: 'execution',
    body: {},
    size: 30,
  });
  massagedEsExecutions.results.forEach((massagedExecution) => {
    if (massagedExecution.updatedAt <= payloadExpiration.getTime()) {
      t.true(esPayloadsEmpty(massagedExecution));
    } else {
      t.false(esPayloadsEmpty(massagedExecution));
    }
  });
  process.env = env;
});

test.serial('handler() throws errors when misconfigured', async (t) => {
  const env = clone(process.env);
  process.env.CLEANUP_RUNNING = 'false';
  process.env.CLEANUP_NON_RUNNING = 'false';

  await t.throwsAsync(handler(), {
    message: 'running and non-running executions configured to be skipped, nothing to do',
  });

  process.env.CLEANUP_RUNNING = 'false';
  process.env.CLEANUP_NON_RUNNING = 'true';
  process.env.PAYLOAD_TIMEOUT = 'frogs';
  await t.throwsAsync(handler(), {
    message: 'Invalid number of days specified in configuration for payloadTimeout: frogs',
  });
  process.env = env;
});

test.serial('handler() iterates through data in batches when updateLimit is set low', async (t) => {
  const env = clone(process.env);

  process.env = localStackConnectionEnv;
  process.env.PG_DATABASE = t.context.testDbName;
  process.env.ES_INDEX = t.context.esIndex;
  process.env.LOCAL_ES_HOST = 'localhost';

  process.env.CLEANUP_RUNNING = 'true';
  process.env.CLEANUP_NON_RUNNING = 'true';
  process.env.PAYLOAD_TIMEOUT = 2;
  process.env.CLEANUP_ES = 'true';
  process.env.CLEANUP_POSTGRES = 'true';

  process.env.UPDATE_LIMIT = 2;

  await handler();
   
  const model = new ExecutionPgModel();
  let massagedPgExecutions = await Promise.all(
    t.context.execution_cumulus_ids.map(
      async (cumulusId) => await model.get(t.context.knex, { cumulus_id: cumulusId })
    )
  );
  let pgCleanedCount = 0;
  massagedPgExecutions.forEach((massagedExecution) => {
    if (pgPayloadsEmpty(massagedExecution)) pgCleanedCount += 1;
  });
  t.is(pgCleanedCount, 2);
  let massagedEsExecutions = await t.context.searchClient.query({
    index: t.context.esIndex,
    type: 'execution',
    body: {},
    size: 30,
  });
  let esCleanedCount = 0;
  massagedEsExecutions.results.forEach((massagedExecution) => {
    if (esPayloadsEmpty(massagedExecution)) esCleanedCount += 1;
  });
  t.is(esCleanedCount, 2);

  await handler();
   
  massagedPgExecutions = await Promise.all(
    t.context.execution_cumulus_ids.map(
      async (cumulusId) => await model.get(t.context.knex, { cumulus_id: cumulusId })
    )
  );
  pgCleanedCount = 0;
  massagedPgExecutions.forEach((massagedExecution) => {
    if (pgPayloadsEmpty(massagedExecution)) pgCleanedCount += 1;
  });
  t.is(pgCleanedCount, 4);
  massagedEsExecutions = await t.context.searchClient.query({
    index: t.context.esIndex,
    type: 'execution',
    body: {},
    size: 30,
  });
  esCleanedCount = 0;
  massagedEsExecutions.results.forEach((massagedExecution) => {
    if (esPayloadsEmpty(massagedExecution)) esCleanedCount += 1;
  });
  t.is(esCleanedCount, 4);

  process.env.UPDATE_LIMIT = 12;

  await handler();
   
  massagedPgExecutions = await Promise.all(
    t.context.execution_cumulus_ids.map(
      async (cumulusId) => await model.get(t.context.knex, { cumulus_id: cumulusId })
    )
  );
  pgCleanedCount = 0;
  massagedPgExecutions.forEach((massagedExecution) => {
    if (pgPayloadsEmpty(massagedExecution)) pgCleanedCount += 1;
  });
  t.is(pgCleanedCount, 16);
  massagedEsExecutions = await t.context.searchClient.query({
    index: t.context.esIndex,
    type: 'execution',
    body: {},
    size: 30,
  });
  esCleanedCount = 0;
  massagedEsExecutions.results.forEach((massagedExecution) => {
    if (esPayloadsEmpty(massagedExecution)) esCleanedCount += 1;
  });
  t.is(esCleanedCount, 16);

  process.env = env;
});

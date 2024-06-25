/* eslint-disable no-await-in-loop */
const test = require('ava');
const rewire = require('rewire');
const moment = require('moment');
const clone = require('lodash/clone');
const esSearch = rewire('@cumulus/es-client/search');
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
const { handler, getExpirationDates } = require('../../lambdas/cleanExecutions');

test.beforeEach(async (t) => {
  t.context.testDbName = randomId('cleanExecutions');
  const { knex, knexAdmin } = await generateLocalTestDb(t.context.testDbName, migrationDir);

  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
  const { esIndex, esClient, searchClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.searchClient = searchClient;
  const awsCredentialsMock = () => () => Promise.resolve({
    accessKeyId: 'testAccessKeyId',
    secretAccessKey: 'testsecretAccessKey',
  });

  esSearch.__set__('fromNodeProviderChain', awsCredentialsMock);

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

test('handler() handles complete expiration', async (t) => {
  const env = clone(process.env);
  process.env = localStackConnectionEnv;
  process.env.PG_DATABASE = t.context.testDbName;
  process.env.ES_INDEX = t.context.esIndex;
  let expirationDays = 4;
  let {
    completeExpiration: expirationDate,
  } = getExpirationDates(
    expirationDays,
    0,
    true,
    false
  );
  process.env.completeExecutionPayloadTimeoutDisable = 'false';
  process.env.nonCompleteExecutionPayloadTimeoutDisable = 'true';
  process.env.completeExecutionPayloadTimeout = expirationDays;

  await handler();
  const model = new ExecutionPgModel();
  let massagedPgExecutions = await Promise.all(
    t.context.execution_cumulus_ids.map(
      async (cumulusId) => await model.get(t.context.knex, { cumulus_id: cumulusId })
    )
  );

  massagedPgExecutions.forEach((massagedExecution) => {
    if (massagedExecution.updated_at < expirationDate && massagedExecution.status === 'completed') {
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
    if (massagedExecution.updatedAt < expirationDate && massagedExecution.status === 'completed') {
      t.true(esPayloadsEmpty(massagedExecution));
    } else {
      t.false(esPayloadsEmpty(massagedExecution));
    }
  });

  expirationDays = 2;
  expirationDate = getExpirationDates(
    expirationDays,
    0,
    true,
    false
  ).completeExpiration;
  process.env.completeExecutionPayloadTimeout = expirationDays;

  await handler();
  massagedPgExecutions = await Promise.all(
    t.context.execution_cumulus_ids.map(
      async (cumulusId) => await model.get(t.context.knex, { cumulus_id: cumulusId })
    )
  );

  massagedPgExecutions.forEach((massagedExecution) => {
    if (massagedExecution.updated_at < expirationDate && massagedExecution.status === 'completed') {
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
    if (massagedExecution.updatedAt < expirationDate.getTime() && massagedExecution.status === 'completed') {
      t.true(esPayloadsEmpty(massagedExecution));
    } else {
      t.false(esPayloadsEmpty(massagedExecution));
    }
  });
  process.env = env;
});

test('handler() handles nonComplete expiration', async (t) => {
  const env = clone(process.env);
  process.env = localStackConnectionEnv;
  process.env.PG_DATABASE = t.context.testDbName;
  process.env.ES_INDEX = t.context.esIndex;
  let expirationDays = 5;
  let {
    nonCompleteExpiration: expirationDate,
  } = getExpirationDates(
    expirationDays,
    expirationDays,
    false,
    true
  );
  process.env.completeExecutionPayloadTimeoutDisable = 'true';
  process.env.nonCompleteExecutionPayloadTimeoutDisable = 'false';
  process.env.nonCompleteExecutionPayloadTimeout = expirationDays;
  await handler();
  const model = new ExecutionPgModel();
  let massagedPgExecutions = await Promise.all(
    t.context.execution_cumulus_ids.map(
      async (cumulusId) => await model.get(t.context.knex, { cumulus_id: cumulusId })
    )
  );
  massagedPgExecutions.forEach((massagedExecution) => {
    if (massagedExecution.updated_at < expirationDate && massagedExecution.status !== 'completed') {
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
    if (massagedExecution.updatedAt < expirationDate && massagedExecution.status !== 'completed') {
      t.true(esPayloadsEmpty(massagedExecution));
    } else {
      t.false(esPayloadsEmpty(massagedExecution));
    }
  });

  expirationDays = 3;
  expirationDate = getExpirationDates(
    expirationDays,
    expirationDays,
    false,
    true
  ).nonCompleteExpiration;
  process.env.nonCompleteExecutionPayloadTimeout = expirationDays;

  await handler();
  massagedPgExecutions = await Promise.all(
    t.context.execution_cumulus_ids.map(
      async (cumulusId) => await model.get(t.context.knex, { cumulus_id: cumulusId })
    )
  );
  massagedPgExecutions.forEach((massagedExecution) => {
    if (massagedExecution.updated_at < expirationDate && massagedExecution.status !== 'completed') {
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
    if (massagedExecution.updatedAt < expirationDate.getTime() && massagedExecution.status !== 'completed') {
      t.true(esPayloadsEmpty(massagedExecution));
    } else {
      t.false(esPayloadsEmpty(massagedExecution));
    }
  });
  process.env = env;
});

test('handler() handles both expirations', async (t) => {
  const env = clone(process.env);
  process.env = localStackConnectionEnv;
  process.env.PG_DATABASE = t.context.testDbName;
  process.env.ES_INDEX = t.context.esIndex;
  let completeExpirationDays = 9;
  let nonCompleteExpirationDays = 9;
  let {
    completeExpiration,
    nonCompleteExpiration,
  } = getExpirationDates(
    completeExpirationDays,
    nonCompleteExpirationDays,
    true,
    true
  );

  process.env.completeExecutionPayloadTimeoutDisable = 'false';
  process.env.nonCompleteExecutionPayloadTimeoutDisable = 'false';
  process.env.completeExecutionPayloadTimeout = completeExpirationDays;
  process.env.nonCompleteExecutionPayloadTimeout = nonCompleteExpirationDays;

  await handler();
  const model = new ExecutionPgModel();
  let massagedPgExecutions = await Promise.all(
    t.context.execution_cumulus_ids.map(
      async (cumulusId) => await model.get(t.context.knex, { cumulus_id: cumulusId })
    )
  );

  massagedPgExecutions.forEach((massagedExecution) => {
    if (massagedExecution.updated_at < nonCompleteExpiration && massagedExecution.status !== 'completed') {
      t.true(pgPayloadsEmpty(massagedExecution));
    } else if (massagedExecution.updated_at < completeExpiration && massagedExecution.status === 'completed') {
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
    if (massagedExecution.updatedAt < nonCompleteExpiration.getTime() && massagedExecution.status !== 'completed') {
      t.true(esPayloadsEmpty(massagedExecution));
    } else if (massagedExecution.updatedAt < completeExpiration.getTime() && massagedExecution.status === 'completed') {
      t.true(esPayloadsEmpty(massagedExecution));
    } else {
      t.false(esPayloadsEmpty(massagedExecution));
    }
  });
  completeExpirationDays = 8;
  nonCompleteExpirationDays = 7;

  nonCompleteExpiration = getExpirationDates(
    completeExpirationDays,
    nonCompleteExpirationDays,
    true,
    true
  ).nonCompleteExpiration;
  completeExpiration = getExpirationDates(
    completeExpirationDays,
    nonCompleteExpirationDays,
    true,
    true
  ).completeExpiration;
  process.env.completeExecutionPayloadTimeout = completeExpirationDays;
  process.env.nonCompleteExecutionPayloadTimeout = nonCompleteExpirationDays;

  await handler();
  massagedPgExecutions = await Promise.all(
    t.context.execution_cumulus_ids.map(
      async (cumulusId) => await model.get(t.context.knex, { cumulus_id: cumulusId })
    )
  );

  massagedPgExecutions.forEach((massagedExecution) => {
    if (massagedExecution.updated_at < nonCompleteExpiration && massagedExecution.status !== 'completed') {
      t.true(pgPayloadsEmpty(massagedExecution));
    } else if (massagedExecution.updated_at < completeExpiration && massagedExecution.status === 'completed') {
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
    if (massagedExecution.updatedAt < nonCompleteExpiration.getTime() && massagedExecution.status !== 'completed') {
      t.true(esPayloadsEmpty(massagedExecution));
    } else if (massagedExecution.updatedAt < completeExpiration.getTime() && massagedExecution.status === 'completed') {
      t.true(esPayloadsEmpty(massagedExecution));
    } else {
      t.false(esPayloadsEmpty(massagedExecution));
    }
  });
  process.env = env;
});

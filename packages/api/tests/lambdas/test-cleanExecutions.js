/* eslint-disable no-await-in-loop */
const test = require('ava');
const moment = require('moment');
const clone = require('lodash/clone');
const {
  translatePostgresExecutionToApiExecution,
  fakeExecutionRecordFactory,
  localStackConnectionEnv,
} = require('@cumulus/db');
const { cleanupTestIndex, createTestIndex } = require('@cumulus/es-client/testUtils');
const { handler, getExpirationDate } = require('../../lambdas/cleanExecutions');
test.beforeEach(async (t) => {
  const { esIndex, esClient, searchClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.searchClient = searchClient;

  const records = [];
  for (let i = 0; i < 20; i += 2) {
    records.push(await translatePostgresExecutionToApiExecution(fakeExecutionRecordFactory({
      updated_at: moment().subtract(i, 'days').toDate(),
      final_payload: '{"a": "b"}',
      original_payload: '{"b": "c"}',
      status: 'completed',
      cumulus_id: i,
    })));
    records.push(await translatePostgresExecutionToApiExecution(fakeExecutionRecordFactory({
      updated_at: moment().subtract(i, 'days').toDate(),
      final_payload: '{"a": "b"}',
      original_payload: '{"b": "c"}',
      status: 'running',
      cumulus_id: i + 1,
    })));
  }
  for (const record of records) {
    await t.context.esClient.client.index({
      body: record,
      id: record.cumulusId,
      index: t.context.esIndex,
      type: 'execution',
      refresh: true,
    });
  }
});

test.afterEach.always(async (t) => {
  await cleanupTestIndex(t.context);
});

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
  process.env.PAYLOAD_TIMEOUT = expirationDays;

  await handler();

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
  process.env.PAYLOAD_TIMEOUT = expirationDays;
  await handler();

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



const { fakeExecutionRecordFactory, translatePostgresExecutionToApiExecution } = require('@cumulus/db');
const { cleanupTestIndex, createTestIndex } = require('@cumulus/es-client/testUtils');

const { cleanupExpiredESExecutionPayloads } = require('../../lambdas/cleanExecutions');


test('cleanupExpiredEsExecutionPayloads() for just running removes expired running executions', async (t) => {
  let timeoutDays = 6;
  await cleanupExpiredESExecutionPayloads(
    timeoutDays,
    true,
    false,
    100,
    t.context.esIndex
  );
  // await es refresh

  let expiration = moment().subtract(timeoutDays, 'days').toDate().getTime();
  let relevantExecutions = await t.context.searchClient.query(
    {
      index: t.context.esIndex,
      type: 'execution',
      body: {
        query: {
          range: {
            updatedAt: {
              lte: expiration,
            },
          },
        },
      },
    }
  );
  for (const execution of relevantExecutions.results) {
    if (execution.status === 'running') {
      t.true(execution.finalPayload === undefined);
      t.true(execution.originalPayload === undefined);
    } else {
      t.false(execution.finalPayload === undefined);
      t.false(execution.originalPayload === undefined);
    }
  }
  let irrelevantExecutions = await t.context.searchClient.query(
    {
      index: t.context.esIndex,
      type: 'execution',
      body: {
        query: {
          range: {
            updatedAt: {
              gt: expiration,
            },
          },
        },
      },
    }
  );
  for (const execution of irrelevantExecutions.results) {
    t.false(execution.finalPayload === undefined);
    t.false(execution.originalPayload === undefined);
  }

  timeoutDays = 2;
  await cleanupExpiredESExecutionPayloads(
    timeoutDays,
    true,
    false,
    100,
    t.context.esIndex
  );

  expiration = moment().subtract(timeoutDays, 'days').toDate().getTime();
  relevantExecutions = await t.context.searchClient.query(
    {
      index: t.context.esIndex,
      type: 'execution',
      body: {
        query: {
          range: {
            updatedAt: {
              lte: expiration,
            },
          },
        },
      },
    }
  );
  for (const execution of relevantExecutions.results) {
    if (execution.status === 'running') {
      t.true(execution.finalPayload === undefined);
      t.true(execution.originalPayload === undefined);
    } else {
      t.false(execution.finalPayload === undefined);
      t.false(execution.originalPayload === undefined);
    }
  }
  irrelevantExecutions = await t.context.searchClient.query(
    {
      index: t.context.esIndex,
      type: 'execution',
      body: {
        query: {
          range: {
            updatedAt: {
              gt: expiration,
            },
          },
        },
      },
    }
  );
  for (const execution of irrelevantExecutions.results) {
    t.false(execution.finalPayload === undefined);
    t.false(execution.originalPayload === undefined);
  }
});

test('cleanupExpiredEsExecutionPayloads() for just nonRunning removes expired non running executions', async (t) => {
  let timeoutDays = 6;
  await cleanupExpiredESExecutionPayloads(
    timeoutDays,
    false,
    true,
    100,
    t.context.esIndex
  );

  let expiration = moment().subtract(timeoutDays, 'days').toDate().getTime();

  let relevantExecutions = await t.context.searchClient.query(
    {
      index: t.context.esIndex,
      type: 'execution',
      body: {
        query: {
          range: {
            updatedAt: {
              lte: expiration,
            },
          },
        },
      },
    }
  );
  for (const execution of relevantExecutions.results) {
    if (execution.status !== 'running') {
      t.true(execution.finalPayload === undefined);
      t.true(execution.originalPayload === undefined);
    } else {
      t.false(execution.finalPayload === undefined);
      t.false(execution.originalPayload === undefined);
    }
  }
  let irrelevantExecutions = await t.context.searchClient.query(
    {
      index: t.context.esIndex,
      type: 'execution',
      body: {
        query: {
          range: {
            updatedAt: {
              gt: expiration,
            },
          },
        },
      },
    }
  );
  for (const execution of irrelevantExecutions.results) {
    t.false(execution.finalPayload === undefined);
    t.false(execution.originalPayload === undefined);
  }

  timeoutDays = 2;
  await cleanupExpiredESExecutionPayloads(
    timeoutDays,
    false,
    true,
    100,
    t.context.esIndex
  );

  expiration = moment().subtract(timeoutDays, 'days').toDate().getTime();
  relevantExecutions = await t.context.searchClient.query(
    {
      index: t.context.esIndex,
      type: 'execution',
      body: {
        query: {
          range: {
            updatedAt: {
              lte: expiration,
            },
          },
        },
      },
    }
  );
  for (const execution of relevantExecutions.results) {
    if (execution.status !== 'running') {
      t.true(execution.finalPayload === undefined);
      t.true(execution.originalPayload === undefined);
    } else {
      t.false(execution.finalPayload === undefined);
      t.false(execution.originalPayload === undefined);
    }
  }
  irrelevantExecutions = await t.context.searchClient.query(
    {
      index: t.context.esIndex,
      type: 'execution',
      body: {
        query: {
          range: {
            updatedAt: {
              gt: expiration,
            },
          },
        },
      },
    }
  );
  for (const execution of irrelevantExecutions.results) {
    t.false(execution.finalPayload === undefined);
    t.false(execution.originalPayload === undefined);
  }
});

test('cleanupExpiredEsExecutionPayloads() for running and nonRunning executions', async (t) => {
  const timeoutDays = 5;
  await cleanupExpiredESExecutionPayloads(
    timeoutDays,
    true,
    true,
    100,
    t.context.esIndex
  );

  const expiration = moment().subtract(timeoutDays, 'days').toDate().getTime();

  const relevant = await t.context.searchClient.query(
    {
      index: t.context.esIndex,
      type: 'execution',
      body: {
        query: {
          range: {
            updatedAt: {
              lte: expiration,
            },
          },
        },
      },
    }
  );
  for (const execution of relevant.results) {
    t.true(execution.finalPayload === undefined);
    t.true(execution.originalPayload === undefined);
  }
  const irrelevantExecutions = await t.context.searchClient.query(
    {
      index: t.context.esIndex,
      type: 'execution',
      body: {
        query: {
          range: {
            updatedAt: {
              gt: expiration,
            },
          },
        },
      },
    }
  );
  for (const execution of irrelevantExecutions.results) {
    t.false(execution.finalPayload === undefined);
    t.false(execution.originalPayload === undefined);
  }
});

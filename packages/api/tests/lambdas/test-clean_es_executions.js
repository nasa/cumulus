/* eslint-disable no-await-in-loop */
const test = require('ava');
const moment = require('moment');

const { fakeExecutionRecordFactory, translatePostgresExecutionToApiExecution } = require('@cumulus/db');
const { cleanupTestIndex, createTestIndex } = require('@cumulus/es-client/testUtils');

const { sleep } = require('@cumulus/common');

const { cleanupExpiredESExecutionPayloads } = require('../../lambdas/cleanExecutions');
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

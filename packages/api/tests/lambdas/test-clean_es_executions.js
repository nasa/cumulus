const { fakeExecutionRecordFactory, translatePostgresExecutionToApiExecution } = require('@cumulus/db');
const { cleanupTestIndex, createTestIndex } = require('@cumulus/es-client/testUtils');
const test = require('ava')

const rewire = require('rewire');
const esSearch = rewire('@cumulus/es-client/search');
// const { Search, getEsClient } = esSearch
const moment = require('moment');
const { sleep } = require('@cumulus/common');
// const localEsHost = process.env.LOCAL_ES_HOST;



const { cleanupExpiredESExecutionPayloads } = require('../../lambdas/cleanExecutions');
test.beforeEach(async (t) => {
  const { esIndex, esClient, searchClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.searchClient = searchClient;
  const awsCredentialsMock = () => () => Promise.resolve({
    accessKeyId: 'testAccessKeyId',
    secretAccessKey: 'testsecretAccessKey',
  });

  esSearch.__set__('fromNodeProviderChain', awsCredentialsMock);
  records = []
  for (let i = 0; i < 20; i+=2) {
    records.push(await translatePostgresExecutionToApiExecution(fakeExecutionRecordFactory({
      updated_at: moment().subtract(i, 'days').toDate(),
      final_payload: '{"a": "b"}',
      original_payload: '{"b": "c"}',
      status: 'completed',
      cumulus_id: i
    })))
    records.push(await translatePostgresExecutionToApiExecution(fakeExecutionRecordFactory({
      updated_at: moment().subtract(i, 'days').toDate(),
      final_payload: '{"a": "b"}',
      original_payload: '{"b": "c"}',
      status: 'running',
      cumulus_id: i+1
    })))
  }
  let i = 0;
  for (const record of records) {
    await t.context.esClient.client.index({
      body: record,
      id: record.cumulusId,
      index: t.context.esIndex,
      type: 'execution',
      refresh: true
    })
    i += 1;
  }


});

test.afterEach.always(async (t) => {
  await cleanupTestIndex(t.context);
})

test.serial('cleanupExpiredEsExecutionPayloads() for just complete removes expired complete executions', async (t) => {
  let completeTimeoutDays = 6
  await cleanupExpiredESExecutionPayloads(
    completeTimeoutDays,
    0,
    true,
    false,
    t.context.esIndex
  );
  await sleep(5000)

  let expiration = moment().subtract(completeTimeoutDays, 'days').toDate().getTime();
  let relevantExecutions = await t.context.searchClient.query(
    {
      index: t.context.esIndex,
      type: 'execution',
      body: {
        query: {
          range: {
            updatedAt: {
              lte: expiration
            }
          }
        }
      }
    }
  )
  for (const execution of relevantExecutions.results) {
    if (execution.status === 'completed') {
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
              gt: expiration
            }
          }
        }
      }
    }
  )
  for (const execution of irrelevantExecutions.results) {
    t.false(execution.finalPayload === undefined);
    t.false(execution.originalPayload === undefined);
  }

  completeTimeoutDays = 2
  await cleanupExpiredESExecutionPayloads(
    completeTimeoutDays,
    0,
    true,
    false,
    t.context.esIndex
  );
  await sleep(5000)

  expiration = moment().subtract(completeTimeoutDays, 'days').toDate().getTime();
  relevantExecutions = await t.context.searchClient.query(
    {
      index: t.context.esIndex,
      type: 'execution',
      body: {
        query: {
          range: {
            updatedAt: {
              lte: expiration
            }
          }
        }
      }
    }
  )
  for (const execution of relevantExecutions.results) {
    if (execution.status === 'completed') {
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
              gt: expiration
            }
          }
        }
      }
    }
  )
  for (const execution of irrelevantExecutions.results) {
    t.false(execution.finalPayload === undefined);
    t.false(execution.originalPayload === undefined);
  }

})

test.serial('cleanupExpiredEsExecutionPayloads() for just nonComplete removes expired non complete executions', async (t) => {
  let nonCompleteTimeoutDays = 6
  await cleanupExpiredESExecutionPayloads(
    0,
    nonCompleteTimeoutDays,
    false,
    true,
    t.context.esIndex
  );
  await sleep(5000)

  let expiration = moment().subtract(nonCompleteTimeoutDays, 'days').toDate().getTime();

  let relevantExecutions = await t.context.searchClient.query(
    {
      index: t.context.esIndex,
      type: 'execution',
      body: {
        query: {
          range: {
            updatedAt: {
              lte: expiration
            }
          }
        }
      }
    }
  )
  for (const execution of relevantExecutions.results) {
    if (execution.status !== 'completed') {
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
              gt: expiration
            }
          }
        }
      }
    }
  )
  for (const execution of irrelevantExecutions.results) {
    t.false(execution.finalPayload === undefined);
    t.false(execution.originalPayload === undefined);
  }

  nonCompleteTimeoutDays = 2
  await cleanupExpiredESExecutionPayloads(
    0,
    nonCompleteTimeoutDays,
    false,
    true,
    t.context.esIndex
  );
  await sleep(5000)

  expiration = moment().subtract(nonCompleteTimeoutDays, 'days').toDate().getTime();
  relevantExecutions = await t.context.searchClient.query(
    {
      index: t.context.esIndex,
      type: 'execution',
      body: {
        query: {
          range: {
            updatedAt: {
              lte: expiration
            }
          }
        }
      }
    }
  )
  for (const execution of relevantExecutions.results) {
    if (execution.status !== 'completed') {
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
              gt: expiration
            }
          }
        }
      }
    }
  )
  for (const execution of irrelevantExecutions.results) {
    t.false(execution.finalPayload === undefined);
    t.false(execution.originalPayload === undefined);
  }

})


test.serial('cleanupExpiredEsExecutionPayloads() for complete and nonComplete executions', async (t) => {
  let nonCompleteTimeoutDays = 6
  let completeTimeoutDays = 4
  await cleanupExpiredESExecutionPayloads(
    completeTimeoutDays,
    nonCompleteTimeoutDays,
    true,
    true,
    t.context.esIndex
  );
  await sleep(5000)

  let nonCompleteExpiration = moment().subtract(nonCompleteTimeoutDays, 'days').toDate().getTime();
  let completeExpiration = moment().subtract(completeTimeoutDays, 'days').toDate().getTime();

  let completeRelevant = await t.context.searchClient.query(
    {
      index: t.context.esIndex,
      type: 'execution',
      body: {
        query: {
          range: {
            updatedAt: {
              lte: completeExpiration
            }
          }
        }
      }
    }
  )
  for (const execution of completeRelevant.results) {
    if (execution.status === 'completed') {
      t.true(execution.finalPayload === undefined);
      t.true(execution.originalPayload === undefined);
    }
  }
  let completeIrrelevantExecutions = await t.context.searchClient.query(
    {
      index: t.context.esIndex,
      type: 'execution',
      body: {
        query: {
          range: {
            updatedAt: {
              gt: completeExpiration
            }
          }
        }
      }
    }
  )
  for (const execution of completeIrrelevantExecutions.results) {
    if (execution.status === 'completed') {
      t.false(execution.finalPayload === undefined);
      t.false(execution.originalPayload === undefined);
    }
  }
  let nonCompleteRelevant = await t.context.searchClient.query(
    {
      index: t.context.esIndex,
      type: 'execution',
      body: {
        query: {
          range: {
            updatedAt: {
              lte: nonCompleteExpiration
            }
          }
        }
      }
    }
  )
  for (const execution of nonCompleteRelevant.results) {
    if (execution.status !== 'completed') {
      t.true(execution.finalPayload === undefined);
      t.true(execution.originalPayload === undefined);
    }
  }
  let nonCompleteIrrelevantExecutions = await t.context.searchClient.query(
    {
      index: t.context.esIndex,
      type: 'execution',
      body: {
        query: {
          range: {
            updatedAt: {
              gt: nonCompleteExpiration
            }
          }
        }
      }
    }
  )
  for (const execution of nonCompleteIrrelevantExecutions.results) {
    if (execution.status !== 'completed') {
      t.false(execution.finalPayload === undefined);
      t.false(execution.originalPayload === undefined);
    }
  }
})
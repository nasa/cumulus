'use strict';

const test = require('ava');
const {
  concurrency: {
    Semaphore
  },
  aws,
  testUtils: {
    randomId
  }
} = require('@cumulus/common');
const { Manager } = require('../../models');
const { handler } = require('../../lambdas/sf-priority-tracker');

const createSnsWorkflowMessage = (status, priorityLevel, maxExecutions = 5) => ({
  Sns: {
    Message: JSON.stringify({
      cumulus_meta: {
        priorityInfo: {
          level: priorityLevel,
          maxExecutions
        }
      },
      payload: {
        meta: {
          status
        }
      }
    })
  }
});

let manager;

test.before(async () => {
  process.env.semaphoreTable = randomId('semaphoreTable');
  manager = new Manager({
    tableName: process.env.semaphoreTable,
    tableHash: { name: 'key', type: 'S' }
  });
  await manager.createTable();
});

test.beforeEach(async (t) => {
  t.context.semaphore = new Semaphore(
    aws.dynamodbDocClient(),
    process.env.semaphoreTable
  );
});

test.after.always(async () => {
  await manager.deleteTable();
});

test.cb('increments priority semaphore info for running workflow message', (t) => {
  const { semaphore } = t.context;
  const priorityLevel = 'low';

  t.plan(1);
  handler({
    Records: [
      createSnsWorkflowMessage('running', priorityLevel)
    ]
  }, {}, async () => {
    const response = await semaphore.get(`${priorityLevel}-executions`);
    t.is(response.Item.semvalue, 1);
    t.end();
  });
});

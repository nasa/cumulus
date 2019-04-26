'use strict';

const test = require('ava');
const {
  concurrency: {
    Semaphore
  },
  aws,
  testUtils: {
    randomId,
    randomString
  }
} = require('@cumulus/common');
const { Manager } = require('../../models');
const { handler } = require('../../lambdas/sf-priority-tracker');

const createSnsWorkflowMessage = ({
  status,
  priorityInfo
}) => ({
  Sns: {
    Message: JSON.stringify({
      cumulus_meta: {
        execution_name: randomString(),
        priorityInfo
      },
      meta: {
        status
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

test('does nothing for a workflow message with no priority info', async (t) => {
  const { semaphore } = t.context;

  await handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'running'
      })
    ]
  });

  const response = await semaphore.scan();
  t.is(response.Items.length, 0);
});

test('does nothing for a workflow message with no status', async (t) => {
  const { semaphore } = t.context;

  await handler({
    Records: [
      createSnsWorkflowMessage({})
    ]
  });

  const response = await semaphore.scan();
  t.is(response.Items.length, 0);
});

test('increments priority semaphore for running workflow message', async (t) => {
  const { semaphore } = t.context;
  const key = randomId('low');

  await handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'running',
        priorityInfo: {
          key,
          maxExecutions: 1
        }
      })
    ]
  });

  const response = await semaphore.get(key);
  t.is(response.Item.semvalue, 1);
});

test('decrements priority semaphore for completed workflow message', async (t) => {
  const { semaphore } = t.context;
  const key = randomId('low');
  const maxExecutions = 1;

  // arbitrarily increment semaphore so it can be decremented
  await semaphore.up(key, maxExecutions);

  await handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'completed',
        priorityInfo: {
          key,
          maxExecutions
        }
      })
    ]
  });

  const response = await semaphore.get(key);
  t.is(response.Item.semvalue, 0);
});

test('decrements priority semaphore for failed workflow message', async (t) => {
  const { semaphore } = t.context;
  const key = randomId('low');
  const maxExecutions = 1;

  // arbitrarily increment semaphore so it can be decremented
  await semaphore.up(key, maxExecutions);

  await handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'failed',
        priorityInfo: {
          key,
          maxExecutions
        }
      })
    ]
  });

  const response = await semaphore.get(key);
  t.is(response.Item.semvalue, 0);
});

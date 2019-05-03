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
const {
  getSemaphoreDecrementTasks,
  handler
}  = require('../../lambdas/sf-semaphore-down');

const createSnsWorkflowMessage = ({
  status,
  priorityKey
}) => ({
  Sns: {
    Message: JSON.stringify({
      cumulus_meta: {
        execution_name: randomString(),
        priorityKey
      },
      meta: {
        status
      }
    })
  }
});

let manager;

const setSemaphoreValue = async (key, value) =>
  aws.dynamodbDocClient().put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key,
      semvalue: value
    }
  }).promise();

test.before(async () => {
  process.env.SemaphoresTable = randomId('semaphoreTable');
  manager = new Manager({
    tableName: process.env.SemaphoresTable,
    tableHash: { name: 'key', type: 'S' }
  });
  await manager.createTable();
});

test.beforeEach(async (t) => {
  t.context.semaphore = new Semaphore(
    aws.dynamodbDocClient(),
    process.env.SemaphoresTable
  );
});

test.after.always(async () => {
  await manager.deleteTable();
});

test('getSemaphoreDecrementTasks() returns empty array for non-SNS message', async (t) => {
  const tasks = getSemaphoreDecrementTasks({});
  t.is(tasks.length, 0);
});

test('getSemaphoreDecrementTasks() returns empty array for SNS message without records', async (t) => {
  const tasks = getSemaphoreDecrementTasks({
    Records: [
      null
    ]
  });
  t.is(tasks.length, 0);
});

test('getSemaphoreDecrementTasks() returns empty array for SNS message with empty record objects', async (t) => {
  let tasks = getSemaphoreDecrementTasks({
    Records: [
      {}
    ]
  });
  t.is(tasks.length, 0);
});

test('getSemaphoreDecrementTasks() returns empty array for SNS message with empty message body', async (t) => {
  const tasks = getSemaphoreDecrementTasks({
    Records: [
      {
        Sns: {
          Message: null
        }
      }
    ]
  });
  t.is(tasks.length, 0);
});

test('sfSemaphoreDown lambda does nothing for a workflow message with no priority info', async (t) => {
  const { semaphore } = t.context;
  const key = randomId('low');

  await setSemaphoreValue(key, 1);
  await handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'completed'
      })
    ]
  });

  const response = await semaphore.get(key);
  t.is(response.Item.semvalue, 1);
});

test('does nothing for a workflow message with no status', async (t) => {
  const { semaphore } = t.context;
  const key = randomId('low');

  await setSemaphoreValue(key, 1);
  await handler({
    Records: [
      createSnsWorkflowMessage({
        priorityKey: key
      })
    ]
  });

  const response = await semaphore.get(key);
  t.is(response.Item.semvalue, 1);
});

test('does nothing for a workflow message for a running workflow', async (t) => {
  const { semaphore } = t.context;
  const key = randomId('low');

  await setSemaphoreValue(key, 1);
  await handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'running',
        priorityKey: key
      })
    ]
  });

  const response = await semaphore.get(key);
  t.is(response.Item.semvalue, 1);
});

test('throws error when attempting to decrement empty semaphore', async (t) => {
  const key = randomId('low');

  await t.throws(handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'completed',
        priorityKey: key
      })
    ]
  }));
});

test('decrements priority semaphore for completed workflow message', async (t) => {
  const { semaphore } = t.context;
  const key = randomId('low');

  // arbitrarily set semaphore so it can be decremented
  await setSemaphoreValue(key, 1);

  await handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'completed',
        priorityKey: key
      })
    ]
  });

  const response = await semaphore.get(key);
  t.is(response.Item.semvalue, 0);
});

test('decrements priority semaphore for failed workflow message', async (t) => {
  const { semaphore } = t.context;
  const key = randomId('low');

  // arbitrarily set semaphore so it can be decremented
  await setSemaphoreValue(key, 1);

  await handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'failed',
        priorityKey: key
      })
    ]
  });

  const response = await semaphore.get(key);
  t.is(response.Item.semvalue, 0);
});

test('handles multiple updates to a single semaphore', async (t) => {
  const { semaphore } = t.context;
  const key = randomId('low');

  // Arbitrarily set semaphore value so it can be decremented
  await setSemaphoreValue(key, 3);

  await handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'failed',
        priorityKey: key
      }),
      createSnsWorkflowMessage({
        status: 'completed',
        priorityKey: key
      })
    ]
  });

  const response = await semaphore.get(key);
  t.is(response.Item.semvalue, 1);
});

test('updates multiple semaphores', async (t) => {
  const { semaphore } = t.context;
  const lowPriorityKey = randomId('low');
  const medPriorityKey = randomId('med');

  await Promise.all([
    setSemaphoreValue(lowPriorityKey, 3),
    setSemaphoreValue(medPriorityKey, 3)
  ]);

  await handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'completed',
        priorityKey: lowPriorityKey
      }),
      createSnsWorkflowMessage({
        status: 'failed',
        priorityKey: lowPriorityKey
      }),
      createSnsWorkflowMessage({
        status: 'completed',
        priorityKey: medPriorityKey
      })
    ]
  });

  let response = await semaphore.get(lowPriorityKey);
  t.is(response.Item.semvalue, 1);

  response = await semaphore.get(medPriorityKey);
  t.is(response.Item.semvalue, 2);
});

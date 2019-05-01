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
const handler = require('../../lambdas/sf-semaphore-down');

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

const setSemaphoreValue = async (key, value) => {
  return aws.dynamodbDocClient().put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key,
      semvalue: value
    }
  }).promise();
}

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

test('does nothing for non-SNS message', async (t) => {
  const { semaphore } = t.context;
  const key = randomId('low');

  await setSemaphoreValue(key, 1);
  await handler({});

  const response = await semaphore.get(key);
  t.is(response.Item.semvalue, 1);  
});

test('does nothing for a workflow message with no priority info', async (t) => {
  const { semaphore } = t.context;
  const key = randomId('low');

  await setSemaphoreValue(key, 1);
  await handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'running'
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
      createSnsWorkflowMessage({})
    ]
  });

  const response = await semaphore.get(key);
  t.is(response.Item.semvalue, 1);  
});

test('throws error when attempting to decrement semaphore below 0', async (t) => {
  const key = randomId('low');

  try {
    await handler({
      Records: [
        createSnsWorkflowMessage({
          status: 'completed',
          priorityInfo: {
            key
          }
        })
      ]
    });
    t.fail();
  } catch (err) {
    t.pass();
  }
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
        priorityInfo: {
          key
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

  // arbitrarily set semaphore so it can be decremented
  await setSemaphoreValue(key, 1);

  await handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'failed',
        priorityInfo: {
          key
        }
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
        priorityInfo: {
          key
        }
      }),
      createSnsWorkflowMessage({
        status: 'completed',
        priorityInfo: {
          key
        }
      })
    ]
  });

  let response = await semaphore.get(key);
  t.is(response.Item.semvalue, 1);
});

test('updates multiple semaphores', async (t) => {
  const { semaphore } = t.context;
  const lowPriorityKey = randomId('low');
  const lowPriorityMax = 3;
  const medPriorityKey = randomId('med');
  const medPriorityMax = 3;

  await Promise.all([
    setSemaphoreValue(lowPriorityKey, lowPriorityMax),
    setSemaphoreValue(medPriorityKey, medPriorityMax)
  ]);

  await handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'completed',
        priorityInfo: {
          key: lowPriorityKey,
          maxExecutions: lowPriorityMax
        }
      }),
      createSnsWorkflowMessage({
        status: 'failed',
        priorityInfo: {
          key: lowPriorityKey,
          maxExecutions: lowPriorityMax
        }
      }),
      createSnsWorkflowMessage({
        status: 'completed',
        priorityInfo: {
          key: medPriorityKey,
          maxExecutions: medPriorityMax
        }
      })
    ]
  });

  let response = await semaphore.get(lowPriorityKey);
  t.is(response.Item.semvalue, 1);

  response = await semaphore.get(medPriorityKey);
  t.is(response.Item.semvalue, 2);
});

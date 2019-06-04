'use strict';

const test = require('ava');
const {
  aws,
  Semaphore,
  testUtils: {
    randomId,
    randomString
  }
} = require('@cumulus/common');
const { Manager } = require('../../models');
const {
  getSemaphoreDecrementTasks,
  handler
} = require('../../lambdas/sf-semaphore-down');

const createSnsWorkflowMessage = ({
  status,
  queueName
}) => ({
  Sns: {
    Message: JSON.stringify({
      cumulus_meta: {
        execution_name: randomString(),
        queueName
      },
      meta: {
        status,
        queueExecutionLimits: {
          [queueName]: 5
        }
      }
    })
  }
});

const createCloudwatchEventMessage = ({
  status,
  queueName
}) => ({
  detail: {
    status,
    output: JSON.stringify({
      cumulus_meta: {
        execution_name: randomString(),
        queueName
      },
      meta: {
        queueExecutionLimits: {
          [queueName]: 5
        }
      }
    })
  }
});

let manager;

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
  t.context.client = aws.dynamodbDocClient();
});

test.after.always(() => manager.deleteTable());

test.skip('getSemaphoreDecrementTasks() returns empty array for non-SNS message', async (t) => {
  const tasks = getSemaphoreDecrementTasks({});
  t.is(tasks.length, 0);
});

test.skip('getSemaphoreDecrementTasks() returns empty array for SNS message without records', async (t) => {
  const tasks = getSemaphoreDecrementTasks({
    Records: [
      null
    ]
  });
  t.is(tasks.length, 0);
});

test.skip('getSemaphoreDecrementTasks() returns empty array for SNS message with empty record objects', async (t) => {
  const tasks = getSemaphoreDecrementTasks({
    Records: [
      {}
    ]
  });
  t.is(tasks.length, 0);
});

test.skip('getSemaphoreDecrementTasks() returns empty array for SNS message with empty message body', async (t) => {
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

test('sfSemaphoreDown lambda does nothing for a workflow message with no queue name', async (t) => {
  const { client, semaphore } = t.context;
  const queueName = randomId('low');

  await client.put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key: queueName,
      semvalue: 1
    }
  }).promise();

  await handler(
    createCloudwatchEventMessage({
      status: 'COMPLETED'
    })
  );

  const response = await semaphore.get(queueName);
  t.is(response.semvalue, 1);
});

test('sfSemaphoreDown lambda does nothing for a workflow message with no status', async (t) => {
  const { client, semaphore } = t.context;
  const queueName = randomId('low');

  await client.put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key: queueName,
      semvalue: 1
    }
  }).promise();

  // await handler({
  //   Records: [
  //     createSnsWorkflowMessage({
  //       queueName
  //     })
  //   ]
  // });
  await handler(
    createCloudwatchEventMessage({
      queueName
    })
  );

  const response = await semaphore.get(queueName);
  t.is(response.semvalue, 1);
});

test('sfSemaphoreDown lambda does nothing for a running workflow message', async (t) => {
  const { client, semaphore } = t.context;
  const queueName = randomId('low');

  await client.put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key: queueName,
      semvalue: 1
    }
  }).promise();

  // await handler({
  //   Records: [
  //     createSnsWorkflowMessage({
  //       status: 'running',
  //       queueName
  //     })
  //   ]
  // });
  await handler(
    createCloudwatchEventMessage({
      status: 'RUNNING',
      queueName
    })
  );

  const response = await semaphore.get(queueName);
  t.is(response.semvalue, 1);
});

test('sfSemaphoreDown lambda throws error when attempting to decrement empty semaphore', async (t) => {
  const queueName = randomId('low');

  // await handler(
  //   createCloudwatchEventMessage({
  //     status: 'COMPLETED',
  //     queueName
  //   })
  // );

  await t.throws(handler(
    createCloudwatchEventMessage({
      status: 'COMPLETED',
      queueName
    })
  ));
});

test('sfSemaphoreDown lambda decrements priority semaphore for completed workflow message', async (t) => {
  const { client, semaphore } = t.context;
  const queueName = randomId('low');

  // arbitrarily set semaphore so it can be decremented
  await client.put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key: queueName,
      semvalue: 1
    }
  }).promise();

  await handler(
    createCloudwatchEventMessage({
      status: 'COMPLETED',
      queueName
    })
  );

  const response = await semaphore.get(queueName);
  t.is(response.semvalue, 0);
});

test('sfSemaphoreDown lambda decrements priority semaphore for failed workflow message', async (t) => {
  const { client, semaphore } = t.context;
  const queueName = randomId('low');

  // arbitrarily set semaphore so it can be decremented
  await client.put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key: queueName,
      semvalue: 1
    }
  }).promise();

  await handler(
    createCloudwatchEventMessage({
      status: 'FAILED',
      queueName
    })
  );

  const response = await semaphore.get(queueName);
  t.is(response.semvalue, 0);
});

test.skip('sfSemaphoreDown lambda handles multiple updates to a single semaphore', async (t) => {
  const { client, semaphore } = t.context;
  const queueName = randomId('low');

  // Arbitrarily set semaphore value so it can be decremented
  await client.put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key: queueName,
      semvalue: 3
    }
  }).promise();

  await handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'failed',
        queueName
      }),
      createSnsWorkflowMessage({
        status: 'completed',
        queueName
      })
    ]
  });

  const response = await semaphore.get(queueName);
  t.is(response.semvalue, 1);
});

test.skip('sfSemaphoreDown lambda updates multiple semaphores', async (t) => {
  const { client, semaphore } = t.context;
  const lowPriorityQueue = randomId('low');
  const medPriorityQueue = randomId('med');

  await Promise.all([
    client.put({
      TableName: process.env.SemaphoresTable,
      Item: {
        key: lowPriorityQueue,
        semvalue: 3
      }
    }).promise(),
    client.put({
      TableName: process.env.SemaphoresTable,
      Item: {
        key: medPriorityQueue,
        semvalue: 3
      }
    }).promise()
  ]);

  await handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'completed',
        queueName: lowPriorityQueue
      }),
      createSnsWorkflowMessage({
        status: 'failed',
        queueName: lowPriorityQueue
      }),
      createSnsWorkflowMessage({
        status: 'completed',
        queueName: medPriorityQueue
      })
    ]
  });

  let response = await semaphore.get(lowPriorityQueue);
  t.is(response.semvalue, 1);

  response = await semaphore.get(medPriorityQueue);
  t.is(response.semvalue, 2);
});

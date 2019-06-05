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
  handleSemaphoreDecrementTask
} = require('../../lambdas/sf-semaphore-down');

const sfEventSource = 'aws.states';
const createCloudwatchEventMessage = ({
  status,
  queueName,
  source = sfEventSource
}) => ({
  source,
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

const testTerminalEventMessage = async (t, status) => {
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

  await handleSemaphoreDecrementTask(
    createCloudwatchEventMessage({
      status,
      queueName
    })
  );

  const response = await semaphore.get(queueName);
  t.is(response.semvalue, 0);
};

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

test('sfSemaphoreDown lambda does nothing for an event with the wrong source', async (t) => {
  const { client, semaphore } = t.context;
  const queueName = randomId('low');

  await client.put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key: queueName,
      semvalue: 1
    }
  }).promise();

  await handleSemaphoreDecrementTask(
    createCloudwatchEventMessage({
      status: 'COMPLETED',
      queueName,
      source: 'fake-source'
    })
  );

  const response = await semaphore.get(queueName);
  t.is(response.semvalue, 1);
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

  await handleSemaphoreDecrementTask(
    createCloudwatchEventMessage({
      status: 'COMPLETED'
    })
  );

  const response = await semaphore.get(queueName);
  t.is(response.semvalue, 1);
});

test('sfSemaphoreDown lambda does nothing for an event with no status', async (t) => {
  const { client, semaphore } = t.context;
  const queueName = randomId('low');

  await client.put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key: queueName,
      semvalue: 1
    }
  }).promise();

  await handleSemaphoreDecrementTask(
    createCloudwatchEventMessage({
      queueName
    })
  );

  const response = await semaphore.get(queueName);
  t.is(response.semvalue, 1);
});

test('sfSemaphoreDown lambda does nothing for an event with a RUNNING status', async (t) => {
  const { client, semaphore } = t.context;
  const queueName = randomId('low');

  await client.put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key: queueName,
      semvalue: 1
    }
  }).promise();

  await handleSemaphoreDecrementTask(
    createCloudwatchEventMessage({
      status: 'RUNNING',
      queueName
    })
  );

  const response = await semaphore.get(queueName);
  t.is(response.semvalue, 1);
});

test('sfSemaphoreDown lambda does nothing for an event with no message', async (t) => {
  const { client, semaphore } = t.context;
  const queueName = randomId('low');

  await client.put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key: queueName,
      semvalue: 1
    }
  }).promise();

  await t.throws(handleSemaphoreDecrementTask({
    source: sfEventSource,
    detail: {
      status: 'COMPLETED'
    }
  }));

  const response = await semaphore.get(queueName);
  t.is(response.semvalue, 1);
});

test('sfSemaphoreDown lambda throws error when attempting to decrement empty semaphore', async (t) => {
  const queueName = randomId('low');

  await t.throws(handleSemaphoreDecrementTask(
    createCloudwatchEventMessage({
      status: 'COMPLETED',
      queueName
    })
  ));
});

test('sfSemaphoreDown lambda throws error for invalid event message', async (t) => {
  await t.throws(handleSemaphoreDecrementTask({
    source: sfEventSource,
    detail: {
      status: 'COMPLETED',
      output: 'invalid message'
    }
  }));
});

test('sfSemaphoreDown lambda decrements semaphore for completed event message', async (t) => {
  await testTerminalEventMessage(t, 'COMPLETED');
});

test('sfSemaphoreDown lambda decrements semaphore for failed event message', async (t) => {
  await testTerminalEventMessage(t, 'FAILED');
});

test('sfSemaphoreDown lambda decrements semaphore for timed out event message', async (t) => {
  await testTerminalEventMessage(t, 'TIMED_OUT');
});

test('sfSemaphoreDown lambda decrements semaphore for aborted event message', async (t) => {
  await testTerminalEventMessage(t, 'ABORTED');
});

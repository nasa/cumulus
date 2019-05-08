'use strict';

const rewire = require('rewire');
const test = require('ava');
const {
  aws,
  DynamoDb,
  errors: {
    ResourcesLockedError
  },
  Semaphore,
  testUtils: {
    randomId
  }
} = require('@cumulus/common');

const sfStarter = rewire('../../lambdas/sf-starter');
const { Manager } = require('../../models');

const { incrementAndDispatch, handler } = sfStarter;

class stubConsumer {
  async consume() {
    return 9;
  }
}

let manager;
const createRuleInput = (queueUrl) => ({
  queueUrl,
  messageLimit: 50,
  timeLimit: 60
});
const createWorkflowMessage = (key, maxExecutions) => ({
  cumulus_meta: {
    priorityKey: key,
    priorityLevels: {
      [key]: {
        maxExecutions
      }
    }
  }
});

// Set dispatch to noop so nothing is attempting to start executions.
sfStarter.__set__('dispatch', () => {});

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
  t.context.queueUrl = await aws.createQueue(randomId('queue'));
});

test.afterEach.always((t) =>
  aws.sqs().deleteQueue({ QueueUrl: t.context.queueUrl }).promise()
);

test.after.always(() => manager.deleteTable());

test('throws error when queueUrl is undefined', async (t) => {
  const ruleInput = createRuleInput();
  const error = await t.throws(handler(ruleInput));
  t.is(error.message, 'queueUrl is missing');
});

test.serial('returns the number of messages consumed', async (t) => {
  const revert = sfStarter.__set__('Consumer', stubConsumer);
  const ruleInput = createRuleInput('queue');
  let data;
  try {
    data = await handler(ruleInput);
  } finally {
    revert();
  }
  t.is(data, 9);
});

test('incrementAndDispatch increments priority semaphore', async (t) => {
  const { queueUrl, semaphore } = t.context;

  const key = randomId('low');
  const message = createWorkflowMessage(key, 5);

  await aws.sendSQSMessage(
    queueUrl,
    message
  );

  await incrementAndDispatch({ Body: message });

  const response = await semaphore.get(key);
  t.is(response.semvalue, 1);
});

test('incrementAndDispatch throws error when trying to increment priority semaphore beyond maximum', async (t) => {
  const { client, queueUrl } = t.context;
  const key = randomId('low');
  const maxExecutions = 5;

  // Set semaphore value to the maximum.
  await DynamoDb.put({
    tableName: process.env.SemaphoresTable,
    item: {
      key,
      semvalue: maxExecutions
    },
    client
  });

  const message = createWorkflowMessage(key, maxExecutions);

  await aws.sendSQSMessage(
    queueUrl,
    message
  );

  const error = await t.throws(
    incrementAndDispatch({ Body: message })
  );
  t.true(error instanceof ResourcesLockedError);
});

test('sf-starter lambda starts 0 executions when priority semaphore is at maximum', async (t) => {
  const { client, queueUrl } = t.context;
  const key = randomId('low');
  const maxExecutions = 5;

  // Set semaphore value to the maximum.
  await DynamoDb.put({
    tableName: process.env.SemaphoresTable,
    item: {
      key,
      semvalue: maxExecutions
    },
    client
  });

  const message = createWorkflowMessage(key, maxExecutions);

  await aws.sendSQSMessage(
    queueUrl,
    message
  );

  const result = await handler({ queueUrl });
  t.is(result, 0);
});

test.skip('sf-starter lambda starts MAX - N executions for messages with priority', async (t) => {
  const { client, queueUrl } = t.context;
  const key = randomId('low');
  const maxExecutions = 5;
  const messageLimit = 5;
  const initialSemValue = 2;

  // Set semaphore value to the maximum.
  await DynamoDb.put({
    tableName: process.env.SemaphoresTable,
    item: {
      key,
      semvalue: initialSemValue
    },
    client
  });

  const message = createWorkflowMessage(key, maxExecutions);

  // Create 4 messages in the queue.
  await Promise.all([
    aws.sendSQSMessage(
      queueUrl,
      message
    ),
    aws.sendSQSMessage(
      queueUrl,
      message
    ),
    aws.sendSQSMessage(
      queueUrl,
      message
    ),
    aws.sendSQSMessage(
      queueUrl,
      message
    )
  ]);

  const result = await handler({ queueUrl, messageLimit });
  // Only 3 executions should have been started, even though 4 messages are in the queue
  // 5 (max) - 2 (initial value) = 3
  t.is(result, 3);

  // All but one of the SQS messages should have been deleted.
  const messages = await aws.receiveSQSMessages(queueUrl, {
    numOfMessages: messageLimit,
    timeout: 0
  });
  t.is(messages.length, 1);
});

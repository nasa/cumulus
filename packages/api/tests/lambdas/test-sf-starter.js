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

// Set dispatch to noop so nothing is attempting to start executions.
sfStarter.__set__('dispatch', () => {});

test.before(async () => {
  process.env.SemaphoresTable = randomId('semaphoreTable');
  manager = new Manager({
    tableName: process.env.SemaphoresTable,
    tableHash: { name: 'key', type: 'S' }
  });
  await manager.createTable();

  process.env.queueUrl = await aws.createQueue(randomId('queue'));
});

test.beforeEach(async (t) => {
  t.context.semaphore = new Semaphore(
    aws.dynamodbDocClient(),
    process.env.SemaphoresTable
  );
  t.context.client = aws.dynamodbDocClient();
});

test.after.always(async (t) => {
  await Promise.all([
    manager.deleteTable(),
    aws.sqs().deleteQueue({ QueueUrl: process.env.queueUrl }).promise()
  ]);
});

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

test('sf-starter lambda increments priority semaphore', async (t) => {
  const { semaphore } = t.context;
  const { queueUrl } = process.env;

  const key = randomId('low');
  await aws.sendSQSMessage(
    queueUrl,
    {
      cumulus_meta: {
        priorityKey: key,
        priorityLevels: {
          [key]: {
            maxExecutions: 5
          }
        }
      }
    }
  );

  await handler({ queueUrl });

  const response = await semaphore.get(key);
  t.is(response.semvalue, 1);
});


test('incrementAndDispatch throws error when trying to increment priority semaphore beyond maximum', async (t) => {
  const { client } = t.context;
  const { queueUrl } = process.env;
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

  const message = {
    cumulus_meta: {
      priorityKey: key,
      priorityLevels: {
        [key]: {
          maxExecutions
        }
      }
    }
  };

  await aws.sendSQSMessage(
    queueUrl,
    message
  );

  const error = await t.throws(incrementAndDispatch({
    Body: message
  }));
  t.true(error instanceof ResourcesLockedError);
});

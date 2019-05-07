'use strict';

const rewire = require('rewire');
const test = require('ava');
const aws = require('@cumulus/common/aws');
const Semaphore = require('@cumulus/common/Semaphore');
const { randomId } = require('@cumulus/common/test-utils');

const handler = rewire('../../lambdas/sf-starter');
const { Manager } = require('../../models');

class stubConsumer {
  async consume() {
    return 9;
  }
}

let manager;
const ruleInput = {
  queueUrl: undefined,
  messageLimit: 50,
  timeLimit: 60
};

// Set dispatch to noop so nothing is attempting to start executions.
handler.__set__('dispatch', () => {});

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
});

test.after.always(async (t) => {
  await Promise.all([
    manager.deleteTable(),
    aws.sqs().deleteQueue({ QueueUrl: process.env.queueUrl }).promise()
  ]);
});

test.serial('throws error when queueUrl is undefined', async (t) => {
  const error = await t.throws(handler(ruleInput));
  t.is(error.message, 'queueUrl is missing');
});

test.serial('calls cb with number of messages received', async (t) => {
  ruleInput.queueUrl = 'queue';
  const revert = handler.__set__('Consumer', stubConsumer);
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

  await handler({
    queueUrl
  });

  const response = await semaphore.get(key);
  t.is(response.semvalue, 1);
});

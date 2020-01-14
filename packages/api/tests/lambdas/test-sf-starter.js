'use strict';

const rewire = require('rewire');
const test = require('ava');

const awsServices = require('@cumulus/aws-client/services');
const {
  createQueue,
  receiveSQSMessages,
  sendSQSMessage
} = require('@cumulus/aws-client/SQS');
const { ResourcesLockedError } = require('@cumulus/common/errors');
const Semaphore = require('@cumulus/common/Semaphore');
const { randomId } = require('@cumulus/common/test-utils');

const sfStarter = rewire('../../lambdas/sf-starter');
const { Manager } = require('../../models');

const {
  incrementAndDispatch,
  handleEvent,
  handleThrottledEvent,
  handleSourceMappingEvent
} = sfStarter;

class stubConsumer {
  async consume() {
    return 9;
  }
}

// Mock startExecution so nothing attempts to start executions.
const stubSFN = () => ({
  startExecution: () => ({
    promise: () => true
  })
});
sfStarter.__set__('sfn', stubSFN);

let manager;

const createRuleInput = (queueUrl, timeLimit = 60) => ({
  queueUrl,
  messageLimit: 50,
  timeLimit
});

const createWorkflowMessage = (queueName, maxExecutions) => JSON.stringify({
  cumulus_meta: {
    queueName
  },
  meta: {
    queueExecutionLimits: {
      [queueName]: maxExecutions
    }
  }
});

const createSendMessageTasks = (queueUrl, message, total) => {
  let count = 0;
  const tasks = [];
  while (count < total) {
    tasks.push(sendSQSMessage(
      queueUrl,
      message
    ));
    count += 1;
  }
  return tasks;
};

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
    awsServices.dynamodbDocClient(),
    process.env.SemaphoresTable
  );
  t.context.client = awsServices.dynamodbDocClient();
  t.context.queueUrl = await createQueue(randomId('queue'));
});

test.afterEach.always(
  (t) =>
    awsServices.sqs().deleteQueue({ QueueUrl: t.context.queueUrl }).promise()
);

test.after.always(() => manager.deleteTable());

test(
  'handleEvent throws error when queueUrl is undefined',
  (t) =>
    t.throwsAsync(
      () => handleEvent(createRuleInput()),
      'queueUrl is missing'
    )
);

test('handleEvent throws error when timeLimit is <= 0', async (t) => {
  await t.throwsAsync(
    () => handleEvent(createRuleInput('test', 0)),
    'timeLimit must be greater than 0'
  );

  await t.throwsAsync(
    () => handleEvent(createRuleInput('test', -1)),
    'timeLimit must be greater than 0'
  );
});

test.serial('handleEvent returns the number of messages consumed', async (t) => {
  const revert = sfStarter.__set__('Consumer', stubConsumer);
  const ruleInput = createRuleInput('queue');
  let data;
  try {
    data = await handleEvent(ruleInput);
  } finally {
    revert();
  }
  t.is(data, 9);
});

test('incrementAndDispatch throws error for message without queue name', async (t) => {
  await t.throwsAsync(
    () => incrementAndDispatch({ Body: createWorkflowMessage() }),
    'cumulus_meta.queueName not set in message'
  );
});

test('incrementAndDispatch throws error for message with no maximum executions value', async (t) => {
  const queueName = randomId('queue');

  await t.throwsAsync(
    () => incrementAndDispatch({ Body: createWorkflowMessage(queueName) }),
    `Could not determine maximum executions for queue ${queueName}`
  );
});

test('incrementAndDispatch increments priority semaphore', async (t) => {
  const { semaphore } = t.context;

  const queueName = randomId('low');
  const message = createWorkflowMessage(queueName, 5);

  await incrementAndDispatch({ Body: message });

  const response = await semaphore.get(queueName);
  t.is(response.semvalue, 1);
});

test.serial('incrementAndDispatch decrements priority semaphore if dispatch() throws error', async (t) => {
  const { semaphore } = t.context;

  const queueName = randomId('low');
  const message = createWorkflowMessage(queueName, 5);

  const stubSFNThrowError = () => ({
    startExecution: () => ({
      promise: async () => {
        const response = await semaphore.get(queueName);
        t.is(response.semvalue, 1);
        throw new Error('testing');
      }
    })
  });
  const revert = sfStarter.__set__('sfn', stubSFNThrowError);

  try {
    await incrementAndDispatch({ Body: message });
  } catch (err) {
    const response = await semaphore.get(queueName);
    t.is(response.semvalue, 0);
  } finally {
    revert();
  }
});

test('incrementAndDispatch throws error when trying to increment priority semaphore beyond maximum', async (t) => {
  const { client } = t.context;
  const queueName = randomId('low');
  const maxExecutions = 5;

  // Set semaphore value to the maximum.
  await client.put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key: queueName,
      semvalue: maxExecutions
    }
  }).promise();

  await t.throwsAsync(
    () => incrementAndDispatch({ Body: createWorkflowMessage(queueName, maxExecutions) }),
    ResourcesLockedError
  );
});

test('handleThrottledEvent starts 0 executions when priority semaphore is at maximum', async (t) => {
  const { client, queueUrl } = t.context;
  const queueName = randomId('low');
  const maxExecutions = 5;

  // Set semaphore value to the maximum.
  await client.put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key: queueName,
      semvalue: maxExecutions
    }
  }).promise();

  const message = createWorkflowMessage(queueName, maxExecutions);

  await sendSQSMessage(
    queueUrl,
    message
  );

  const result = await handleThrottledEvent({ queueUrl });
  t.is(result, 0);
});

test('handleThrottledEvent starts MAX - N executions for messages with priority', async (t) => {
  const { client, queueUrl } = t.context;

  const queueName = randomId('low');
  const maxExecutions = 5;
  const initialSemValue = 2;
  const numOfMessages = 4;
  const messageLimit = numOfMessages;

  // Set initial semaphore value.
  await client.put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key: queueName,
      semvalue: initialSemValue
    }
  }).promise();

  const message = createWorkflowMessage(queueName, maxExecutions);

  // Create 4 messages in the queue.
  const sendMessageTasks = createSendMessageTasks(queueUrl, message, numOfMessages);
  await Promise.all(sendMessageTasks);

  const result = await handleThrottledEvent({
    queueUrl,
    messageLimit
  }, 0);
  // Only 3 executions should have been started, even though 4 messages are in the queue
  //   5 (semaphore max )- 2 (initial value) = 3 available executions
  t.is(result, maxExecutions - initialSemValue);

  // There should be 1 message left in the queue.
  //   4 initial messages - 3 messages read/deleted = 1 message
  const messages = await receiveSQSMessages(queueUrl, {
    numOfMessages: messageLimit
  });
  t.is(messages.length, numOfMessages - result);
});

test('handleThrottledEvent respects maximum executions for multiple priority levels', async (t) => {
  const { client, queueUrl } = t.context;

  const lowPriorityQueue = randomId('low');
  const lowMaxExecutions = 3;
  const lowInitialValue = 2;
  const lowMessageCount = 2;

  const medPriorityQueue = randomId('med');
  const medMaxExecutions = 5;
  const medInitialValue = 3;
  const medMessageCount = 4;

  const messageLimit = lowMessageCount + medMessageCount;

  // Set initial semaphore values.
  await Promise.all([
    client.put({
      TableName: process.env.SemaphoresTable,
      Item: {
        key: lowPriorityQueue,
        semvalue: lowInitialValue
      }
    }).promise(),
    client.put({
      TableName: process.env.SemaphoresTable,
      Item: {
        key: medPriorityQueue,
        semvalue: medInitialValue
      }
    }).promise()
  ]);

  const lowPriorityMessage = createWorkflowMessage(lowPriorityQueue, lowMaxExecutions);
  const lowMessageTasks = createSendMessageTasks(queueUrl, lowPriorityMessage, lowMessageCount);

  const medPriorityMessage = createWorkflowMessage(medPriorityQueue, medMaxExecutions);
  const medMessageTasks = createSendMessageTasks(queueUrl, medPriorityMessage, medMessageCount);

  await Promise.all([
    ...lowMessageTasks,
    ...medMessageTasks
  ]);

  const result = await handleThrottledEvent({
    queueUrl,
    messageLimit
  }, 0);

  // Max - initial value = Number of executions started
  const expectedLowResult = lowMaxExecutions - lowInitialValue;
  const expectedMedResult = medMaxExecutions - medInitialValue;
  const expectedResult = expectedLowResult + expectedMedResult;
  t.is(result, expectedResult);

  const messages = await receiveSQSMessages(queueUrl, {
    numOfMessages: messageLimit
  });

  // Number of messages - number of messages read/deleted = number of messages left
  const expectedLowCount = (lowMessageCount - expectedLowResult);
  const expectedMedCount = (medMessageCount - expectedMedResult);
  const expectedMessageCount = expectedLowCount + expectedMedCount;
  t.is(messages.length, expectedMessageCount);
});

test('handleSourceMappingEvent calls dispatch on messages in an EventSource event', async (t) => {
  // EventSourceMapping input uses 'body' instead of 'Body'
  const event = {
    Records: [
      {
        body: createWorkflowMessage('test')
      },
      {
        body: createWorkflowMessage('test')
      }
    ]
  };
  const output = await handleSourceMappingEvent(event);

  const dispatchReturn = stubSFN().startExecution().promise();
  output.forEach((o) => t.is(o, dispatchReturn));
});

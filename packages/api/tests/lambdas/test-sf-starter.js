'use strict';

const isNumber = require('lodash/isNumber');
const rewire = require('rewire');
const sinon = require('sinon');
const test = require('ava');

const awsServices = require('@cumulus/aws-client/services');
const sqs = require('@cumulus/aws-client/SQS');
const {
  createQueue,
  receiveSQSMessages,
  sendSQSMessage,
} = require('@cumulus/aws-client/SQS');
const { ExecutionAlreadyExists } = require('@cumulus/aws-client/StepFunctions');
const { ResourcesLockedError } = require('@cumulus/errors');
const { sleep } = require('@cumulus/common');
const { randomId } = require('@cumulus/common/test-utils');

const Semaphore = require('../../lib/Semaphore');
const sfStarter = rewire('../../lambdas/sf-starter');
const { Manager } = require('../../models');
const { log } = require('console');
const { exit } = require('process');

const {
  dispatch,
  incrementAndDispatch,
  handleEvent,
  handleThrottledEvent,
  handleSourceMappingEvent,
  handleThrottledRateLimitedEvent,
} = sfStarter;

class stubConsumer {
  consume() {
    return Promise.resolve(9);
  }
}

// Mock startExecution so nothing attempts to start executions.
const stubSFN = () => ({
  startExecution: () => ({
    promise: () => Promise.resolve({}),
  }),
});
sfStarter.__set__('sfn', stubSFN);

let manager;

const createRuleInput = (queueUrl, timeLimit = 60) => ({
  queueUrl,
  messageLimit: 50,
  timeLimit,
});

const createRuleInputRateLimited = (queueUrls, rateLimitPerSecond, stagingTimeLimit) => ({
  queueUrls,
  rateLimitPerSecond,
  stagingTimeLimit,
});

const createWorkflowMessage = (queueUrl, maxExecutions) => JSON.stringify({
  cumulus_meta: {
    queueUrl,
    queueExecutionLimits: {
      [queueUrl]: maxExecutions,
    },
  },
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
    tableHash: { name: 'key', type: 'S' },
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
  t.context.queueUrls = await Promise.all([
    createQueue(randomId('queue')),
    createQueue(randomId('queue')),
    createQueue(randomId('queue')),
  ]);
  t.context.lambdaContext = {
    getRemainingTimeInMillis: () => 240000,
  };
});

test.afterEach.always(
  (t) =>
    awsServices.sqs().deleteQueue({ QueueUrl: t.context.queueUrl })
);

test.after.always(() => manager.deleteTable());

test('dispatch() sets the workflow_start_time', async (t) => {
  const { queueUrl } = t.context;

  const cumulusMessage = {
    cumulus_meta: {
      state_machine: 'my-state-machine',
      execution_name: 'my-execution-name',
    },
  };

  const sqsMessage = {
    Body: JSON.stringify(cumulusMessage),
  };

  let startExecutionParams;

  await sfStarter.__with__({
    sfn: () => ({
      startExecution: (params) => {
        startExecutionParams = params;
        return ({
          promise: () => Promise.resolve({}),
        });
      },
    }),
  })(() => sfStarter.__get__('dispatch')(queueUrl, sqsMessage));

  const executionInput = JSON.parse(startExecutionParams.input);

  t.true(isNumber(executionInput.cumulus_meta.workflow_start_time));
  t.true(executionInput.cumulus_meta.workflow_start_time <= Date.now());
});

test('dispatch() sets cumulus_meta.queueUrl', async (t) => {
  const { queueUrl } = t.context;

  const cumulusMessage = {
    cumulus_meta: {
      state_machine: 'my-state-machine',
      execution_name: 'my-execution-name',
    },
  };

  const sqsMessage = {
    Body: JSON.stringify(cumulusMessage),
  };

  let startExecutionParams;

  await sfStarter.__with__({
    sfn: () => ({
      startExecution: (params) => {
        startExecutionParams = params;
        return ({
          promise: () => Promise.resolve({}),
        });
      },
    }),
  })(() => sfStarter.__get__('dispatch')(queueUrl, sqsMessage));

  const executionInput = JSON.parse(startExecutionParams.input);
  t.is(executionInput.cumulus_meta.queueUrl, queueUrl);
});

test(
  'handleEvent throws error when queueUrl is undefined',
  (t) =>
    t.throwsAsync(
      () => handleEvent(createRuleInput()),
      { message: 'queueUrl is missing' }
    )
);

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

test.serial('handleEvent deletes message if execution already exists', async (t) => {
  const { queueUrl } = t.context;
  const ruleInput = createRuleInput(queueUrl);
  const deleteMessageStub = sinon.stub(sqs, 'deleteSQSMessage').resolves({});

  const maxExecutions = 5;
  const message = createWorkflowMessage(queueUrl, maxExecutions);
  await sendSQSMessage(
    queueUrl,
    message
  );

  const stubSFNThrowError = () => ({
    startExecution: () => {
      throw new ExecutionAlreadyExists({ $metadata: {} });
    },
  });
  const revert = sfStarter.__set__('sfn', stubSFNThrowError);

  t.teardown(() => {
    revert();
    deleteMessageStub.restore();
  });

  await handleEvent(ruleInput, dispatch);
  t.true(deleteMessageStub.called);
});

test.serial('handleThrottledRateLimitedEvent respects stagingTimeLimit', async (t) => {
  const { queueUrls } = t.context;
  const maxExecutions = 1000; // A large number to ensure we don't hit throttling from this
  const stagingTimeLimit = 10;
  const rateLimitPerSecond = 5;
  // This should be enough that we don't work through all of them based on the rate, number of queues and time limit.
  const testMessageCount = stagingTimeLimit * rateLimitPerSecond / queueUrls.length + 50;
  const ruleInput = createRuleInputRateLimited(queueUrls, rateLimitPerSecond, stagingTimeLimit);
  for (const queueUrl of queueUrls) {
    const message = createWorkflowMessage(queueUrl, maxExecutions);
    const sendMessageTasks = createSendMessageTasks(queueUrl, message, testMessageCount);
    await Promise.all(sendMessageTasks);

    await sendSQSMessage(
      queueUrl,
      message
    );
  }

  const startTime = Date.now();
  const result = await handleThrottledRateLimitedEvent(ruleInput, t.context.lambdaContext);
  const elapsedTime = Date.now() - startTime;

  // Verify that the function completed within a reasonable time relative to the timeLimit
  // The elapsed time should be close to the timeLimit, not significantly longer
  t.true(elapsedTime >= stagingTimeLimit * 1000);
  t.true(elapsedTime < (stagingTimeLimit * 1000) + 5000); // Allow buffer for processing

  // Verify that not all messages were processed (proving timeLimit was respected)
  t.true(testMessageCount * queueUrls.length > result);
});

test.serial('handleThrottledRateLimitedEvent respects rateLimitPerSecond', async (t) => {
  const { queueUrls } = t.context;
  const maxExecutions = 1000; // A large number to ensure we don't hit throttling from this
  const stagingTimeLimit = 10;
  const rateLimitPerSecond = 10;
  // This should be enough that we don't work through all of them based on the rate, number of queues and time limit.
  const testMessageCount = stagingTimeLimit * rateLimitPerSecond / queueUrls.length + 50;
  const ruleInput = createRuleInputRateLimited(queueUrls, rateLimitPerSecond, stagingTimeLimit);
  for (const queueUrl of queueUrls) {
    const message = createWorkflowMessage(queueUrl, maxExecutions);
    const sendMessageTasks = createSendMessageTasks(queueUrl, message, testMessageCount);
    await Promise.all(sendMessageTasks);

    await sendSQSMessage(
      queueUrl,
      message
    );
  }

  const startExecutionStub = sinon.stub().returns({
    promise: () => Promise.resolve({}),
  });
  const stubSFNWithSpy = () => ({
    startExecution: startExecutionStub,
  });
  const revert = sfStarter.__set__('sfn', stubSFNWithSpy);

  t.teardown(() => {
    revert();
  });

  const result = await handleThrottledRateLimitedEvent(ruleInput, t.context.lambdaContext);

  // Verify that startExecution was called, limited by the rateLimitPerSecond
  const expectedMaxCalls = Math.floor(stagingTimeLimit * rateLimitPerSecond * queueUrls.length);
  t.true(startExecutionStub.callCount > 0);
  t.true(startExecutionStub.callCount <= expectedMaxCalls);
});

test.serial('handleThrottledRateLimitedEvent ends prior to the lambda timeout', async (t) => {
  const { queueUrls } = t.context;
  const maxExecutions = 1000; // A large number to ensure we don't hit throttling from this
  const stagingTimeLimit = 100;  // Setting a large value to make sure this isn't a limiting factor
  const rateLimitPerSecond = 10;
  const lambdaTimeoutMilliseconds = 8000;

  const lambdaContext = {
    getRemainingTimeInMillis: () => {
      return lambdaTimeoutMilliseconds - (Date.now() - startTime);
    }
  };

  // This should be enough that we don't work through all of them based on the rate, number of queues and time limit.
  const testMessageCount = stagingTimeLimit * rateLimitPerSecond / queueUrls.length + 50;
  const ruleInput = createRuleInputRateLimited(queueUrls, rateLimitPerSecond, stagingTimeLimit);
  for (const queueUrl of queueUrls) {
    const message = createWorkflowMessage(queueUrl, maxExecutions);
    const sendMessageTasks = createSendMessageTasks(queueUrl, message, testMessageCount);
    await Promise.all(sendMessageTasks);

    await sendSQSMessage(
      queueUrl,
      message
    );
  }

  const startTime = Date.now();
  await handleThrottledRateLimitedEvent(ruleInput, lambdaContext);
  const elapsedTime = Date.now() - startTime;

  // Verify that the function completed in less than the lambda timeout
  t.true(elapsedTime < lambdaTimeoutMilliseconds);

});

test('incrementAndDispatch throws error for message without queue URL', async (t) => {
  const { queueUrl } = t.context;
  await t.throwsAsync(
    () => incrementAndDispatch(queueUrl, { Body: createWorkflowMessage() })
  );
});

test('incrementAndDispatch throws error for message with no maximum executions value', async (t) => {
  const { queueUrl } = t.context;

  await t.throwsAsync(
    () => incrementAndDispatch(queueUrl, { Body: createWorkflowMessage(queueUrl) })
  );
});

test('incrementAndDispatch increments priority semaphore', async (t) => {
  const { semaphore, queueUrl } = t.context;

  const message = createWorkflowMessage(queueUrl, 5);

  await incrementAndDispatch(queueUrl, { Body: message });

  const response = await semaphore.get(queueUrl);
  t.is(response.semvalue, 1);
});

test.serial('incrementAndDispatch decrements priority semaphore if dispatch() throws error', async (t) => {
  const { semaphore, queueUrl } = t.context;

  const message = createWorkflowMessage(queueUrl, 5);
  const stubSFNThrowError = () => ({
    startExecution: async () => {
      const response = await semaphore.get(queueUrl);
      t.is(response.semvalue, 1);
      throw new Error('testing');
    },
  });
  const revert = sfStarter.__set__('sfn', stubSFNThrowError);

  try {
    await incrementAndDispatch(queueUrl, { Body: message });
  } catch (error) {
    const response = await semaphore.get(queueUrl);
    t.is(response.semvalue, 0);
  } finally {
    revert();
  }
});

test('incrementAndDispatch throws error when trying to increment priority semaphore beyond maximum', async (t) => {
  const { client, queueUrl } = t.context;
  const maxExecutions = 5;

  // Set semaphore value to the maximum.
  await client.put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key: queueUrl,
      semvalue: maxExecutions,
    },
  });

  await t.throwsAsync(
    () => incrementAndDispatch(queueUrl, { Body: createWorkflowMessage(queueUrl, maxExecutions) }),
    { instanceOf: ResourcesLockedError }
  );
});

test.serial('handleThrottledEvent logs error and deletes message when execution already exists', async (t) => {
  const { semaphore, queueUrl } = t.context;
  const maxExecutions = 5;

  const message = createWorkflowMessage(queueUrl, maxExecutions);

  await sendSQSMessage(
    queueUrl,
    message
  );

  // Stub to throw an error
  const deleteMessageStub = sinon.stub(sqs, 'deleteSQSMessage').resolves({});
  const stubSFNThrowError = () => ({
    startExecution: () => ({
      promise: async () => {
        const response = await semaphore.get(queueUrl);
        t.is(response.semvalue, 1);
        throw new ExecutionAlreadyExists({ $metadata: {} });
      },
    }),
  });
  const revert = sfStarter.__set__('sfn', stubSFNThrowError);
  t.teardown(() => {
    revert();
    deleteMessageStub.restore();
  });

  const result = await handleThrottledEvent({ queueUrl });
  t.is(result, 1);
  t.true(deleteMessageStub.called);
});

test('handleThrottledEvent starts 0 executions when priority semaphore is at maximum', async (t) => {
  const { client, queueUrl } = t.context;
  const maxExecutions = 5;

  // Set semaphore value to the maximum.
  await client.put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key: queueUrl,
      semvalue: maxExecutions,
    },
  });

  const message = createWorkflowMessage(queueUrl, maxExecutions);

  await sendSQSMessage(
    queueUrl,
    message
  );

  const result = await handleThrottledEvent({ queueUrl });
  t.is(result, 0);
});

test('handleThrottledEvent starts MAX - N executions for messages with priority', async (t) => {
  const { client, queueUrl } = t.context;

  const maxExecutions = 5;
  const initialSemValue = 2;
  const numOfMessages = 4;
  const messageLimit = numOfMessages;

  // Set initial semaphore value.
  await client.put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key: queueUrl,
      semvalue: initialSemValue,
    },
  });

  const message = createWorkflowMessage(queueUrl, maxExecutions);

  // Create 4 messages in the queue.
  const sendMessageTasks = createSendMessageTasks(queueUrl, message, numOfMessages);
  await Promise.all(sendMessageTasks);

  const result = await handleThrottledEvent({
    queueUrl,
    messageLimit,
    timeLimit: 0,
  }, 1);
  // Only 3 executions should have been started, even though 4 messages are in the queue
  //   5 (semaphore max )- 2 (initial value) = 3 available executions
  t.is(result, maxExecutions - initialSemValue);

  await sleep(2000);

  // There should be 1 message left in the queue.
  //   4 initial messages - 3 messages read/deleted = 1 message
  const messages = await receiveSQSMessages(queueUrl, {
    numOfMessages: messageLimit,
  });
  t.is(messages.length, numOfMessages - result);
});

test.serial('handleSourceMappingEvent calls dispatch on messages in an EventSource event', async (t) => {
  // EventSourceMapping input uses 'body' instead of 'Body'
  const failedMessageId = 'id-3';
  const event = {
    queueUrl: 'queue-url',
    Records: [
      {
        eventSourceARN: 'queue-url',
        body: createWorkflowMessage('test'),
        ReceiptHandle: 'receipt-handle-1',
        messageId: 'id-1',
      },
      {
        eventSourceARN: 'queue-url',
        body: createWorkflowMessage('test'),
        ReceiptHandle: 'receipt-handle-2',
        messageId: 'id-2',
      },
      {
        eventSourceARN: 'queue-url',
        body: createWorkflowMessage('test'),
        ReceiptHandle: 'receipt-handle-3',
        messageId: failedMessageId,
      },
    ],
  };
  const stubSFNThrowError = () => ({
    startExecution: () => {
      throw new ExecutionAlreadyExists({ $metadata: {} });
    },
  });
  const stubSFNRandomThrowError = () => ({
    startExecution: () => {
      const error = new Error('RandomError');
      throw error;
    },
  });
  const deleteMessageStub = sinon.stub(sqs, 'deleteSQSMessage').resolves({});

  // Stub second call to throw ExecutionAlreadyExists error
  const sfStub = sinon.stub()
    .onFirstCall()
    .callsFake(stubSFN)
    .onSecondCall()
    .callsFake(stubSFNThrowError)
    .onThirdCall()
    .callsFake(stubSFNRandomThrowError);
  const revert = sfStarter.__set__('sfn', sfStub);

  t.teardown(() => {
    revert();
    deleteMessageStub.restore();
  });

  const output = await handleSourceMappingEvent(event);
  // Check that batchItemFailures contain the non ExecutionAlreadyExists error messageId.
  t.deepEqual(output, { batchItemFailures: [{ itemIdentifier: failedMessageId }] });
});

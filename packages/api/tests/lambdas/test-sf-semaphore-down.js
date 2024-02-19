'use strict';

const sinon = require('sinon');
const proxyquire = require('proxyquire');
const test = require('ava');

const awsServices = require('@cumulus/aws-client/services');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const stepFunctions = require('@cumulus/message/StepFunctions');

const Semaphore = require('../../lib/Semaphore');
const { Manager } = require('../../models');
const {
  handleSemaphoreDecrementTask,
} = require('../../lambdas/sf-semaphore-down');

const sfEventSource = 'aws.states';
const createCloudwatchEventMessage = ({
  status,
  queueUrl,
  source = sfEventSource,
}) => {
  const cumulusMeta = {
    execution_name: randomString(),
  };
  if (queueUrl) {
    cumulusMeta.queueUrl = queueUrl;
    cumulusMeta.queueExecutionLimits = {
      [queueUrl]: 5,
    };
  }
  const message = JSON.stringify({
    cumulus_meta: cumulusMeta,
  });
  const detail = (status === 'SUCCEEDED'
    ? { status, output: message }
    : { status, input: message });
  return { source, detail };
};

const createCloudwatchPackagedEventMessage = ({
  status,
  queueUrl,
  source = sfEventSource,
}) => {
  const message = JSON.stringify({
    cumulus_meta: {
      execution_name: randomString(),
      queueUrl,
    },
    replace: {
      Bucket: 'cumulus-sandbox-testing',
      Key: 'stubbedKey',
    },
  });
  const detail = (status === 'SUCCEEDED'
    ? { status, output: message }
    : { status, input: message });
  return { source, detail };
};

const createExecutionMessage = ((queueUrl) => (
  {
    cumulus_meta: {
      execution_name: randomString(),
      queueUrl,
      queueExecutionLimits: {
        [queueUrl]: 5,
      },
    },
  }
));

const testTerminalEventMessage = async (t, status) => {
  const { client, semaphore } = t.context;
  const queueUrl = randomId('low');

  // arbitrarily set semaphore so it can be decremented
  await client.put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key: queueUrl,
      semvalue: 1,
    },
  });

  await handleSemaphoreDecrementTask(
    createCloudwatchEventMessage({
      status,
      queueUrl,
    })
  );

  const response = await semaphore.get(queueUrl);
  t.is(response.semvalue, 0);
};

const assertInvalidDecrementEvent = (t, output) =>
  t.is(output, 'Not a valid decrement event, no operation performed');

let manager;

test.before(async () => {
  process.env.SemaphoresTable = randomId('semaphoreTable');
  manager = new Manager({
    tableName: process.env.SemaphoresTable,
    tableHash: { name: 'key', type: 'S' },
  });
  await manager.createTable();
});

test.beforeEach((t) => {
  t.context.semaphore = new Semaphore(
    awsServices.dynamodbDocClient(),
    process.env.SemaphoresTable
  );
  t.context.client = awsServices.dynamodbDocClient();
});

test.after.always(() => manager.deleteTable());

test('sfSemaphoreDown lambda does nothing for an event with the wrong source', async (t) => {
  const queueUrl = randomId('low');

  const output = await handleSemaphoreDecrementTask(
    createCloudwatchEventMessage({
      status: 'SUCCEEDED',
      queueUrl,
      source: 'fake-source',
    })
  );

  assertInvalidDecrementEvent(t, output);
});

test('sfSemaphoreDown lambda does nothing for a workflow message with no queue URL', async (t) => {
  const output = await handleSemaphoreDecrementTask(
    createCloudwatchEventMessage({
      status: 'SUCCEEDED',
    })
  );

  assertInvalidDecrementEvent(t, output);
});

test('sfSemaphoreDown lambda does nothing for an event with no status', async (t) => {
  const queueUrl = randomId('low');

  const output = await handleSemaphoreDecrementTask(
    createCloudwatchEventMessage({
      queueUrl,
    })
  );

  assertInvalidDecrementEvent(t, output);
});

test('sfSemaphoreDown lambda does nothing for an event with a RUNNING status', async (t) => {
  const queueUrl = randomId('low');

  const output = await handleSemaphoreDecrementTask(
    createCloudwatchEventMessage({
      status: 'RUNNING',
      queueUrl,
    })
  );

  assertInvalidDecrementEvent(t, output);
});

test('sfSemaphoreDown lambda does nothing for an event with no message', async (t) => {
  const output = await handleSemaphoreDecrementTask({
    source: sfEventSource,
    detail: {
      status: 'SUCCEEDED',
    },
  });

  assertInvalidDecrementEvent(t, output);
});

test('sfSemaphoreDown lambda throws error when attempting to decrement empty semaphore', async (t) => {
  const queueUrl = randomId('low');

  await t.throwsAsync(
    () => handleSemaphoreDecrementTask(
      createCloudwatchEventMessage({
        status: 'SUCCEEDED',
        queueUrl,
      })
    )
  );
});

test('sfSemaphoreDown lambda returns not a valid event for invalid event message', async (t) => {
  const output = await handleSemaphoreDecrementTask({
    source: sfEventSource,
    detail: {
      status: 'SUCCEEDED',
      output: 'invalid message',
    },
  });

  assertInvalidDecrementEvent(t, output);
});

test('sfSemaphoreDown lambda decrements semaphore for s3-stored event message', async (t) => {
  const status = 'SUCCEEDED';
  const { client, semaphore } = t.context;
  const queueUrl = randomId('low');
  // arbitrarily set semaphore so it can be decremented
  await client.put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key: queueUrl,
      semvalue: 1,
    },
  });

  const stubReturn = createExecutionMessage(queueUrl);
  const pullStepFunctionStub = sinon.stub(stepFunctions, 'pullStepFunctionEvent');
  try {
    const proxiedFunction = proxyquire('../../lambdas/sf-semaphore-down', { pullStepFunctionEvent: pullStepFunctionStub }).handleSemaphoreDecrementTask;
    pullStepFunctionStub.returns(stubReturn);
    await proxiedFunction(
      createCloudwatchPackagedEventMessage({ status, queueUrl })
    );
    const response = await semaphore.get(queueUrl);
    t.is(response.semvalue, 0);
  } finally {
    pullStepFunctionStub.restore();
  }
});

test('sfSemaphoreDown lambda decrements semaphore for completed event message', async (t) => {
  await testTerminalEventMessage(t, 'SUCCEEDED');
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

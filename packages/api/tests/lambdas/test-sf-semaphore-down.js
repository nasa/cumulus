'use strict';

const sinon = require('sinon');
const commonAws = require('@cumulus/common/aws');
const proxyquire = require('proxyquire');
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
}) => {
  const message = JSON.stringify({
    cumulus_meta: {
      execution_name: randomString(),
      queueName
    },
    meta: {
      queueExecutionLimits: {
        [queueName]: 5
      }
    }
  });
  const detail = (status === 'SUCCEEDED'
    ? { status, output: message }
    : { status, input: message });
  return { source, detail };
};

const createCloudwatchPackagedEventMessage = ({
  status,
  queueName,
  source = sfEventSource
}) => {
  const message = JSON.stringify({
    cumulus_meta: {
      execution_name: randomString(),
      queueName
    },
    replace: {
      Bucket: 'cumulus-sandbox-testing',
      Key: 'stubbedKey'
    }
  });
  const detail = (status === 'SUCCEEDED'
    ? { status, output: message }
    : { status, input: message });
  return { source, detail };
};


const createExecutionMessage = ((queueName) => (
  {
    cumulus_meta: {
      execution_name: randomString(),
      queueName
    },
    meta: {
      queueExecutionLimits: {
        [queueName]: 5
      }
    }
  }
));


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

const assertInvalidDecrementEvent = (t, output) =>
  t.is(output, 'Not a valid decrement event, no operation performed');

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
  const queueName = randomId('low');

  const output = await handleSemaphoreDecrementTask(
    createCloudwatchEventMessage({
      status: 'SUCCEEDED',
      queueName,
      source: 'fake-source'
    })
  );

  assertInvalidDecrementEvent(t, output);
});

test('sfSemaphoreDown lambda does nothing for a workflow message with no queue name', async (t) => {
  const output = await handleSemaphoreDecrementTask(
    createCloudwatchEventMessage({
      status: 'SUCCEEDED'
    })
  );

  assertInvalidDecrementEvent(t, output);
});

test('sfSemaphoreDown lambda does nothing for an event with no status', async (t) => {
  const queueName = randomId('low');

  const output = await handleSemaphoreDecrementTask(
    createCloudwatchEventMessage({
      queueName
    })
  );

  assertInvalidDecrementEvent(t, output);
});

test('sfSemaphoreDown lambda does nothing for an event with a RUNNING status', async (t) => {
  const queueName = randomId('low');

  const output = await handleSemaphoreDecrementTask(
    createCloudwatchEventMessage({
      status: 'RUNNING',
      queueName
    })
  );

  assertInvalidDecrementEvent(t, output);
});

test('sfSemaphoreDown lambda does nothing for an event with no message', async (t) => {
  const output = await handleSemaphoreDecrementTask({
    source: sfEventSource,
    detail: {
      status: 'SUCCEEDED'
    }
  });

  assertInvalidDecrementEvent(t, output);
});

test('sfSemaphoreDown lambda throws error when attempting to decrement empty semaphore', async (t) => {
  const queueName = randomId('low');

  await t.throwsAsync(
    () => handleSemaphoreDecrementTask(
      createCloudwatchEventMessage({
        status: 'SUCCEEDED',
        queueName
      })
    )
  );
});

test('sfSemaphoreDown lambda returns not a valid event for invalid event message', async (t) => {
  const output = await handleSemaphoreDecrementTask({
    source: sfEventSource,
    detail: {
      status: 'SUCCEEDED',
      output: 'invalid message'
    }
  });

  assertInvalidDecrementEvent(t, output);
});

test('sfSemaphoreDown lambda decrements semaphore for s3-stored event message', async (t) => {
  const status = 'SUCCEEDED';
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

  const stubReturn = createExecutionMessage(queueName);
  const pullStepFunctionStub = sinon.stub(commonAws, 'pullStepFunctionEvent');
  try {
    const proxiedFunction = proxyquire('../../lambdas/sf-semaphore-down', { pullStepFunctionEvent: pullStepFunctionStub }).handleSemaphoreDecrementTask;
    pullStepFunctionStub.returns(stubReturn);
    await proxiedFunction(
      createCloudwatchPackagedEventMessage({ status, queueName })
    );
    const response = await semaphore.get(queueName);
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

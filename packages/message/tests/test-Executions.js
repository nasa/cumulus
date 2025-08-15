'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  getExecutionUrlFromArn,
  getMessageExecutionArn,
  getMessageExecutionName,
  getMessageStateMachineArn,
  getStateMachineArnFromExecutionArn,
  getMessageExecutionParentArn,
  getMessageCumulusVersion,
  getMessageExecutionOriginalPayload,
  getMessageExecutionFinalPayload,
  generateExecutionApiRecordFromMessage,
} = require('../Executions');

test.beforeEach((t) => {
  t.context.executionName = `${cryptoRandomString({ length: 5 })}_execution`;

  t.context.workflowStartTime = Date.now();
  t.context.cumulusMessage = {
    cumulus_meta: {
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine',
      execution_name: t.context.executionName,
      workflow_start_time: t.context.workflowStartTime,
      cumulus_version: '1.2.3',
    },
    meta: {
      status: 'running',
      collection: {
        name: 'my-name',
        version: 'my-version',
      },
    },
    payload: {
      value: 'my-payload',
    },
  };

  t.context.executionArn = `arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:${t.context.executionName}`;
});

test('getExecutionUrlFromArn returns correct URL when no region environment variable is specified', (t) => {
  t.is(
    getExecutionUrlFromArn('fake-arn'),
    'https://console.aws.amazon.com/states/home?region=us-east-1'
      + '#/executions/details/fake-arn'
  );
});

test.serial('getExecutionUrlFromArn returns correct URL when a region environment variable is specified', (t) => {
  process.env.AWS_DEFAULT_REGION = 'fake-region';
  t.is(
    getExecutionUrlFromArn('fake-arn'),
    'https://console.aws.amazon.com/states/home?region=fake-region'
      + '#/executions/details/fake-arn'
  );
  delete process.env.AWS_DEFAULT_REGION;
});

test('getMessageExecutionName throws error if cumulus_meta.execution_name is missing', (t) => {
  t.throws(
    () => getMessageExecutionName({ cumulus_meta: {} }),
    { message: 'cumulus_meta.execution_name not set in message' }
  );
});

test('getMessageStateMachineArn throws error if cumulus_meta.state_machine is missing', (t) => {
  t.throws(
    () => getMessageStateMachineArn({ cumulus_meta: {} }),
    { message: 'cumulus_meta.state_machine not set in message' }
  );
});

test('getMessageExecutionArn returns correct execution ARN for valid message', (t) => {
  const cumulusMessage = {
    cumulus_meta: {
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine',
      execution_name: 'my-execution-name',
    },
  };

  const executionArn = getMessageExecutionArn(cumulusMessage);

  t.is(
    executionArn,
    'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name'
  );
});

test('getMessageExecutionArn returns null for an invalid message', (t) => {
  const executionArn = getMessageExecutionArn({});
  t.is(executionArn, null);
});

test('getStateMachineArnFromExecutionArn returns correct state machine ARN', (t) => {
  t.is(
    getStateMachineArnFromExecutionArn(
      'arn:aws:states:us-east-1:000000000000:execution:fake-Workflow:abcd-1234-efgh-5678'
    ),
    'arn:aws:states:us-east-1:000000000000:stateMachine:fake-Workflow'
  );
});

test('getStateMachineArnFromExecutionArn returns null for no input', (t) => {
  t.is(
    getStateMachineArnFromExecutionArn(),
    null
  );
});

test('getMessageExecutionParentArn returns correct parent execution ARN', (t) => {
  const executionArn = getMessageExecutionParentArn({
    cumulus_meta: {
      parentExecutionArn: 'test-arn',
    },
  });
  t.is(executionArn, 'test-arn');
});

test('getMessageExecutionParentArn returns undefined if there is no parent execution ARN', (t) => {
  const executionArn = getMessageExecutionParentArn({
    cumulus_meta: {},
  });
  t.is(executionArn, undefined);
});

test('getMessageCumulusVersion returns correct Cumulus version', (t) => {
  const cumulusVersion = getMessageCumulusVersion({
    cumulus_meta: {
      cumulus_version: '1.2.3',
    },
  });
  t.is(cumulusVersion, '1.2.3');
});

test('getMessageCumulusVersion returns undefined if there is no cumulus version', (t) => {
  const cumulusVersion = getMessageCumulusVersion({
    cumulus_meta: {},
  });
  t.is(cumulusVersion, undefined);
});

test('getMessageExecutionOriginalPayload returns original payload when status is running', (t) => {
  const payload = {
    foo: 'bar',
  };
  t.deepEqual(
    getMessageExecutionOriginalPayload({
      meta: {
        status: 'running',
      },
      payload,
    }),
    payload
  );
});

test('getMessageExecutionOriginalPayload returns undefined for non-running execution', (t) => {
  const payload = {
    foo: 'bar',
  };
  t.is(
    getMessageExecutionOriginalPayload({
      meta: {
        status: 'completed',
      },
      payload,
    }),
    undefined
  );
});

test('getMessageExecutionFinalPayload returns final payload when status is not running', (t) => {
  const payload = {
    foo: 'bar',
  };
  t.deepEqual(
    getMessageExecutionFinalPayload({
      meta: {
        status: 'completed',
      },
      payload,
    }),
    payload
  );
});

test('getMessageExecutionFinalPayload returns undefined for running execution', (t) => {
  const payload = {
    foo: 'bar',
  };
  t.is(
    getMessageExecutionFinalPayload({
      meta: {
        status: 'running',
      },
      payload,
    }),
    undefined
  );
});

test('generateExecutionApiRecordFromMessage() returns the correct record from workflow message', (t) => {
  const {
    cumulusMessage,
    executionArn,
    executionName,
    workflowStartTime,
  } = t.context;

  const actualRecord = generateExecutionApiRecordFromMessage(cumulusMessage);

  const expectedRecord = {
    name: executionName,
    arn: executionArn,
    cumulusVersion: '1.2.3',
    execution: `https://console.aws.amazon.com/states/home?region=us-east-1#/executions/details/${executionArn}`,
    collectionId: 'my-name___my-version',
    error: {},
    status: 'running',
    createdAt: workflowStartTime,
    timestamp: actualRecord.timestamp,
    updatedAt: actualRecord.updatedAt,
    originalPayload: {
      value: 'my-payload',
    },
    duration: 0,
    archived: false,
  };

  t.deepEqual(actualRecord, expectedRecord);
});

test('generateExecutionApiRecordFromMessage() throws an exception if the execution ARN cannot be determined', (t) => {
  t.throws(
    () => generateExecutionApiRecordFromMessage({
      cumulus_meta: {},
    })
  );
});

test('generateExecutionApiRecordFromMessage() throws an exception if meta.status is not present', (t) => {
  const { cumulusMessage } = t.context;

  delete cumulusMessage.meta.status;

  t.throws(() => generateExecutionApiRecordFromMessage(cumulusMessage));
});

test('generateExecutionApiRecordFromMessage() returns a record with asyncOperationId when available', (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.cumulus_meta.asyncOperationId = 'my-asyncOperationId';

  const record = generateExecutionApiRecordFromMessage(cumulusMessage);

  t.is(record.asyncOperationId, 'my-asyncOperationId');
});

test('generateExecutionApiRecordFromMessage() returns a record with parentArn when available', (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.cumulus_meta.parentExecutionArn = 'my-parentArn';

  const record = generateExecutionApiRecordFromMessage(cumulusMessage);

  t.is(record.parentArn, 'my-parentArn');
});

test('generateExecutionApiRecordFromMessage() returns a record with tasks when available', (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.meta.workflow_tasks = 'my-tasks';

  const record = generateExecutionApiRecordFromMessage(cumulusMessage);

  t.is(record.tasks, 'my-tasks');
});

test('generateExecutionApiRecordFromMessage() returns a record with type when available', (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.meta.workflow_name = 'my-workflow-name';

  const record = generateExecutionApiRecordFromMessage(cumulusMessage);

  t.is(record.type, 'my-workflow-name');
});

test('generateExecutionApiRecordFromMessage() returns a record with correct payload for non-running messages', (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload = 'my-payload';

  const record = generateExecutionApiRecordFromMessage(cumulusMessage);

  t.is(record.finalPayload, 'my-payload');
  t.is(record.originalPayload, undefined);
});

test('generateExecutionApiRecordFromMessage() returns a record with correct duration for non-running messages', (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.meta.status = 'completed';

  const startTime = cumulusMessage.cumulus_meta.workflow_start_time;
  cumulusMessage.cumulus_meta.workflow_stop_time = startTime + 1000;

  const record = generateExecutionApiRecordFromMessage(cumulusMessage);

  t.is(record.duration, 1);
});

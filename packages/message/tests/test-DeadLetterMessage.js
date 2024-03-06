'use strict';

const test = require('ava');

const { randomString } = require('@cumulus/common/test-utils');

const { unwrapDeadLetterCumulusMessage, isDLQRecordLike } = require('../DeadLetterMessage');

test('unwrapDeadLetterCumulusMessage unwraps an SQS message', async (t) => {
  const cumulusMessage = {
    cumulus_meta: {
      execution_name: randomString(),
    },
  };
  const testMessage = {
    eventSource: 'aws:sqs',
    body: JSON.stringify(cumulusMessage),
  };
  t.deepEqual(await unwrapDeadLetterCumulusMessage(testMessage), cumulusMessage);
});

test('unwrapDeadLetterCumulusMessage unwraps an AWS States message', async (t) => {
  const cumulusMessage = {
    cumulus_meta: {
      execution_name: randomString(),
    },
  };
  const testMessage = {
    source: 'aws.states',
    detail: {
      stopDate: Date.now(),
      output: JSON.stringify(cumulusMessage),
      status: 'SUCCEEDED',
    },
  };
  const actual = await unwrapDeadLetterCumulusMessage(testMessage);
  const expected = {
    ...cumulusMessage,
    meta: { status: 'completed' },
  };
  expected.cumulus_meta.workflow_stop_time = testMessage.detail.stopDate;
  t.deepEqual(actual, expected);
});

test('unwrapDeadLetterCumulusMessage unwraps an AWS States message with only input', async (t) => {
  const cumulusMessage = {
    cumulus_meta: {
      execution_name: randomString(),
    },
  };
  const testMessage = {
    source: 'aws.states',
    detail: {
      stopDate: Date.now(),
      input: JSON.stringify(cumulusMessage),
      status: 'RUNNING',
    },
  };

  const actual = await unwrapDeadLetterCumulusMessage(testMessage);
  const expected = {
    ...cumulusMessage,
    meta: { status: 'running' },
  };
  expected.cumulus_meta.workflow_stop_time = testMessage.detail.stopDate;
  t.deepEqual(actual, expected);
});

test('unwrapDeadLetterCumulusMessage unwraps an AWS states message within an SQS record', async (t) => {
  const stopDate = Date.now();
  const cumulusMessage = {
    cumulus_meta: {
      execution_name: randomString(),
    },
  };

  const testStatesMessage = {
    source: 'aws.states',
    detail: {
      stopDate,
      output: JSON.stringify(cumulusMessage),
      status: 'SUCCEEDED',
    },
  };
  const testSqsMessage = {
    sourceEvent: 'aws:sqs',
    body: JSON.stringify(testStatesMessage),
  };

  const actual = await unwrapDeadLetterCumulusMessage(testSqsMessage);
  const expected = {
    ...cumulusMessage,
    meta: { status: 'completed' },
  };
  expected.cumulus_meta.workflow_stop_time = stopDate;
  t.deepEqual(actual, expected);
});

test('unwrapDeadLetterCumulusMessage returns wrapped message on error', async (t) => {
  const invalidMessage = {
    Body: 'Not a json object',
  };
  t.deepEqual(await unwrapDeadLetterCumulusMessage(invalidMessage), invalidMessage);
});

test('unwrapDeadLetterCumulusMessage returns an non-unwrappable message', async (t) => {
  const testMessage = {
    eventSource: 'aws:something-strange',
    contents: JSON.stringify({
      key: 'value',
    }),
  };
  t.deepEqual(await unwrapDeadLetterCumulusMessage(testMessage), testMessage);
});

test('isDLQRecordLike correctly filters for DLQ record shaped objects', (t) => {
  t.false(isDLQRecordLike('aaa')); // must be an object
  t.false(isDLQRecordLike({ a: 'b' })); // object must contain a body
  t.false(isDLQRecordLike({ body: '{a: "b"}' })); // object must contain an error attribute
  t.true(isDLQRecordLike({ body: '{a: "b"}', error: 'a' }));
  t.true(isDLQRecordLike({ Body: '{a: "b"}', error: 'a' }));
});

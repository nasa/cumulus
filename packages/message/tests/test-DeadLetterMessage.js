'use strict';

const test = require('ava');

const { randomString } = require('@cumulus/common/test-utils');

const { unwrapDeadLetterCumulusMessage } = require('../DeadLetterMessage');

test('unwrapDeadLetterCumulusMessage unwraps an SQS message', (t) => {
  const cumulusMessage = {
    cumulus_meta: {
      execution_name: randomString(),
    },
  };
  const testMessage = {
    eventSource: 'aws:sqs',
    body: JSON.stringify(cumulusMessage),
  };
  t.deepEqual(unwrapDeadLetterCumulusMessage(testMessage), cumulusMessage);
});

test('unwrapDeadLetterCumulusMessage unwraps an AWS States message', (t) => {
  const cumulusMessage = {
    cumulus_meta: {
      execution_name: randomString(),
    },
  };
  const testMessage = {
    source: 'aws.states',
    detail: {
      output: JSON.stringify(cumulusMessage),
    },
  };
  t.deepEqual(unwrapDeadLetterCumulusMessage(testMessage), cumulusMessage);
});

test('unwrapDeadLetterCumulusMessage unwraps an AWS States message with only input', (t) => {
  const cumulusMessage = {
    cumulus_meta: {
      execution_name: randomString(),
    },
  };
  const testMessage = {
    source: 'aws.states',
    detail: {
      input: JSON.stringify(cumulusMessage),
    },
  };
  t.deepEqual(unwrapDeadLetterCumulusMessage(testMessage), cumulusMessage);
});

test('unwrapDeadLetterCumulusMessage unwraps an AWS states message within an SQS message', (t) => {
  const cumulusMessage = {
    cumulus_meta: {
      execution_name: randomString(),
    },
  };
  const testStatesMessage = {
    source: 'aws.states',
    detail: {
      output: JSON.stringify(cumulusMessage),
    },
  };
  const testSqsMessage = {
    sourceEvent: 'aws:sqs',
    body: JSON.stringify(testStatesMessage),
  };
  t.deepEqual(unwrapDeadLetterCumulusMessage(testSqsMessage), cumulusMessage);
});

test('unwrapDeadLetterCumulusMessage returns wrapped message on error', (t) => {
  const invalidMessage = {
    eventSource: 'aws:sqs',
    detail: {},
  };
  t.deepEqual(unwrapDeadLetterCumulusMessage(invalidMessage), invalidMessage);
});

test('unwrapDeadLetterCumulusMessage returns an non-unwrappable message', (t) => {
  const testMessage = {
    eventSource: 'aws:something-strange',
    contents: JSON.stringify({
      key: 'value',
    }),
  };
  t.deepEqual(unwrapDeadLetterCumulusMessage(testMessage), testMessage);
});

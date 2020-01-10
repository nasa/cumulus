'use strict';

const sinon = require('sinon');
const test = require('ava');

const {
  fromSfnExecutionName,
  toSfnExecutionName,
  pullStepFunctionEvent
} = require('../step-functions');
const s3Utils = require('../s3');

test('toSfnExecutionName() truncates names to 80 characters', (t) => {
  t.is(
    toSfnExecutionName(
      [
        '123456789_123456789_123456789_123456789_',
        '123456789_123456789_123456789_123456789_'
      ],
      ''
    ),
    '123456789_123456789_123456789_123456789_123456789_123456789_123456789_123456789_'
  );
});

test('toSfnExecutionName() joins fields by the given delimiter', (t) => {
  t.is(
    toSfnExecutionName(['a', 'b', 'c'], '-'),
    'a-b-c'
  );
});

test('toSfnExecutionName() escapes occurrences of the delimiter in fields', (t) => {
  t.is(
    toSfnExecutionName(['a', 'b-c', 'd'], '-'),
    'a-b!u002dc-d'
  );
});

test('toSfnExecutionName() escapes unsafe characters with unicode-like escape codes', (t) => {
  t.is(
    toSfnExecutionName(['a', 'b$c', 'd'], '-'),
    'a-b!u0024c-d'
  );
});

test('toSfnExecutionName() escapes exclammation points (used for escape codes)', (t) => {
  t.is(
    toSfnExecutionName(['a', 'b!c', 'd'], '-'),
    'a-b!u0021c-d'
  );
});

test('toSfnExecutionName() does not escape safe characters', (t) => {
  t.is(
    toSfnExecutionName(['a', 'b.+-_=', 'c'], 'z'),
    'azb.+-_=zc'
  );
});

test('fromSfnExecutionName() returns fields separated by the given delimiter', (t) => {
  t.deepEqual(
    fromSfnExecutionName('a-b-c', '-'),
    ['a', 'b', 'c']
  );
});

test('fromSfnExecutionName() interprets bang-escaped unicode in the input string', (t) => {
  t.deepEqual(
    fromSfnExecutionName('a-b!u002dc-d', '-'),
    ['a', 'b-c', 'd']
  );
});

test('fromSfnExecutionName() copes with quotes in the input string', (t) => {
  t.deepEqual(
    fromSfnExecutionName('foo"bar'),
    ['foo"bar']
  );
});

test('pullStepFunctionEvent returns original message if message not on S3', async (t) => {
  const event = {
    cumulus_meta: {
      state_machine: 'state machine',
      execution_name: 'execution'
    },
    meta: {
      bucket: 'test bucket'
    }
  };

  const message = await pullStepFunctionEvent(event);

  t.deepEqual(message, event);
});

test.serial('pullStepFunctionEvent returns message from S3 to target', async (t) => {
  const expectedMessage = {
    cumulus_meta: {
      state_machine: 'state machine',
      execution_name: 'execution'
    },
    payload: {
      someKey: 'some data'
    }
  };

  const event = {
    cumulus_meta: {
      state_machine: 'state machine',
      execution_name: 'execution'
    },
    payload: {},
    replace: {
      Bucket: 'test bucket',
      Key: 'key',
      TargetPath: '$.payload'
    }
  };

  const stub = sinon.stub(s3Utils, 'getS3Object').resolves({
    Body: JSON.stringify({ someKey: 'some data' })
  });
  try {
    const message = await pullStepFunctionEvent(event);
    t.deepEqual(message, expectedMessage);
  } finally {
    stub.restore();
  }
});

test.serial('pullStepFunctionEvent returns message from S3', async (t) => {
  const fullMessage = {
    cumulus_meta: {
      state_machine: 'state machine',
      execution_name: 'execution'
    },
    meta: {
      bucket: 'test bucket'
    }
  };

  const event = {
    cumulus_meta: {
      state_machine: 'state machine',
      execution_name: 'execution'
    },
    replace: {
      Bucket: 'test bucket',
      Key: 'key'
    }
  };

  const stub = sinon.stub(s3Utils, 'getS3Object').resolves({ Body: JSON.stringify(fullMessage) });

  try {
    const message = await pullStepFunctionEvent(event);
    t.deepEqual(message, fullMessage);
  } finally {
    stub.restore();
  }
});

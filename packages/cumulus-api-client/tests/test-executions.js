'use strict';

const test = require('ava');
const rewire = require('rewire');
const executionsRewire = rewire('../executions');


test.before(async (t) => {
  t.context.testPrefix = 'unitTestStack';
  t.context.arn = 'testArn';
  t.context.testExecutionReturn = { body: '{"some": "object"}' };
});

test('getExecution calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/executions/${t.context.arn}`
    }
  };
  const callback = async (configObject) => {
    t.deepEqual(expected, configObject);
    return (t.context.testExecutionReturn);
  };
  let revertCallback;
  try {
    revertCallback = executionsRewire.__set__('invokeApi', callback);
    await t.notThrowsAsync(executionsRewire.getExecution({
      prefix: t.context.testPrefix,
      arn: t.context.arn
    }));
  } finally {
    revertCallback();
  }
});

test('getExecutions calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/executions'
    }
  };

  const callback = async (configObject) => {
    t.deepEqual(expected, configObject);
  };

  let revertCallback;
  try {
    revertCallback = executionsRewire.__set__('invokeApi', callback);
    await t.notThrowsAsync(executionsRewire.getExecutions({
      prefix: t.context.testPrefix,
    }));
  } finally {
    revertCallback();
  }
});

test('getExecutionStatus calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/executions/status/${t.context.arn}`
    }
  };

  const callback = async (configObject) => {
    t.deepEqual(expected, configObject);
  };
  let revertCallback;
  try {
    revertCallback = executionsRewire.__set__('invokeApi', callback);
    await t.notThrowsAsync(executionsRewire.getExecutionStatus({
      prefix: t.context.testPrefix,
      arn: t.context.arn,
    }));
  } finally {
    revertCallback();
  }
});

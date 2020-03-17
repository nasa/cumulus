'use strict';

const test = require('ava');
const rewire = require('rewire');
const executionsRewire = rewire('../executions');


test.before(async (t) => {
  t.context.testPrefix = 'unitTestStack';
  t.context.arn = 'testArn';
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
  };

  await t.notThrowsAsync(executionsRewire.getExecution(
    t.context.testPrefix,
    t.context.arn,
    callback
  ));
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

  await t.notThrowsAsync(executionsRewire.getExecutions({
    prefix: t.context.testPrefix,
    callback
  }));
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

  await t.notThrowsAsync(executionsRewire.getExecutionStatus({
    prefix: t.context.testPrefix,
    arn: t.context.arn,
    callback
  }));
});

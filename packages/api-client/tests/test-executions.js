'use strict';

const test = require('ava');
const executionsApi = require('../executions');

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
    t.deepEqual(configObject, expected);
    return (t.context.testExecutionReturn);
  };

  await t.notThrowsAsync(executionsApi.getExecution({
    prefix: t.context.testPrefix,
    arn: t.context.arn,
    callback
  }));
});

test('getExecutions calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/executions',
      queryStringParameters: undefined
    }
  };

  const callback = async (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(executionsApi.getExecutions({
    prefix: t.context.testPrefix,
    callback
  }));
});

test('getExecutions calls the callback with the expected object with query params', async (t) => {
  const query = { limit: 50 };
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/executions',
      queryStringParameters: query
    }
  };

  const callback = async (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(executionsApi.getExecutions({
    prefix: t.context.testPrefix,
    query,
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
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(executionsApi.getExecutionStatus({
    prefix: t.context.testPrefix,
    arn: t.context.arn,
    callback
  }));
});

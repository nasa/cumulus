'use strict';

const test = require('ava');
const { randomId } = require('../../common/test-utils');
const executionsApi = require('../executions');

test.before((t) => {
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
      path: `/executions/${t.context.arn}`,
    },
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
    return Promise.resolve(t.context.testExecutionReturn);
  };

  await t.notThrowsAsync(executionsApi.getExecution({
    prefix: t.context.testPrefix,
    arn: t.context.arn,
    callback,
  }));
});

test('getExecutions calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/executions',
      queryStringParameters: undefined,
    },
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(executionsApi.getExecutions({
    prefix: t.context.testPrefix,
    callback,
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
      queryStringParameters: query,
    },
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(executionsApi.getExecutions({
    prefix: t.context.testPrefix,
    query,
    callback,
  }));
});

test('getExecutionStatus calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/executions/status/${t.context.arn}`,
    },
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(executionsApi.getExecutionStatus({
    prefix: t.context.testPrefix,
    arn: t.context.arn,
    callback,
  }));
});

test('createExecution calls the callback with the expected object', async (t) => {
  const execution = { arn: randomId('arn'), foo: 'bar' };
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: { 'Content-Type': 'application/json' },
      path: '/executions',
      body: JSON.stringify(execution),
    },
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };
  await t.notThrowsAsync(executionsApi.createExecution({
    callback,
    prefix: t.context.testPrefix,
    body: execution,
  }));
});

test('updateExecution calls the callback with the expected object', async (t) => {
  const execution = { arn: randomId('arn'), foo: 'bar' };
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      headers: { 'Content-Type': 'application/json' },
      path: `/executions/${execution.arn}`,
      body: JSON.stringify(execution),
    },
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };
  await t.notThrowsAsync(executionsApi.updateExecution({
    callback,
    prefix: t.context.testPrefix,
    body: execution,
  }));
});

test('deleteExecution calls the callback with the expected object and returns the parsed response', async (t) => {
  const prefix = 'unitTestStack';
  const executionArn = 'id-1234';

  const expected = {
    prefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/executions/${executionArn}`,
    },
  };
  const resultBody = {
    foo: 'bar',
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);

    return { body: JSON.stringify(resultBody) };
  };

  const result = await executionsApi.deleteExecution({
    prefix,
    executionArn,
    callback,
  });

  t.deepEqual(JSON.parse(result.body), resultBody);
});

test('searchExecutionsByGranules calls the callback with the expected object and returns the parsed response', async (t) => {
  const payload = {
    granules: [
      { granuleId: randomId('granuleId1'), collectionId: randomId('collectionId1') },
      { granuleId: randomId('granuleId2'), collectionId: randomId('collectionId2') },
    ],
  };

  const query = { length: 5 };

  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/executions/search-by-granules',
      queryStringParameters: query,
      body: JSON.stringify(payload),
    },
    expectedStatusCodes: [200],
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };

  await t.notThrowsAsync(executionsApi.searchExecutionsByGranules({
    prefix: t.context.testPrefix,
    payload,
    query,
    callback,
  }));
});

test('workflowsByGranules calls the callback with the expected object and returns the parsed response', async (t) => {
  const payload = {
    granules: [
      { granuleId: randomId('granuleId1'), collectionId: randomId('collectionId1') },
      { granuleId: randomId('granuleId2'), collectionId: randomId('collectionId2') },
    ],
  };

  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/executions/workflows-by-granules',
      body: JSON.stringify(payload),
    },
    expectedStatusCodes: 202,
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };

  await t.notThrowsAsync(executionsApi.workflowsByGranules({
    prefix: t.context.testPrefix,
    payload,
    callback,
  }));
});

test('bulkDeleteByCollection calls the callback with the expected object and returns the parsed response', async (t) => {
  const payload = {
    collectionId: randomId('collectionId'),
    esBatchSize: 100,
    dbBatchSize: 200,
  };

  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/executions/bulk-delete-by-collection/',
      body: JSON.stringify(payload),
    },
    expectedStatusCodes: 202,
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };

  await t.notThrowsAsync(executionsApi.bulkDeleteByCollection({
    prefix: t.context.testPrefix,
    payload,
    callback,
  }));
});

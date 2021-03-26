'use strict';

const test = require('ava');
const asyncOperations = require('../asyncOperations');

test('getAsyncOperation calls the callback with the expected object and returns the parsed response', async (t) => {
  const prefix = 'unitTestStack';
  const asyncOperationId = 'id-1234';

  const expected = {
    prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/asyncOperations/${asyncOperationId}`,
    },
  };

  const callback = async (configObject) => {
    t.deepEqual(configObject, expected);

    return { body: '{ "foo": "bar" }' };
  };

  const result = await asyncOperations.getAsyncOperation({
    prefix,
    asyncOperationId,
    callback,
  });

  t.deepEqual(JSON.parse(result.body), { foo: 'bar' });
});

test('listAsyncOperations calls the callback with the expected object and returns the parsed response', async (t) => {
  const prefix = 'unitTestStack';
  const query = { fake: 'query' };

  const expected = {
    prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/asyncOperations/',
      query,
    },
  };

  const callback = async (configObject) => {
    t.deepEqual(configObject, expected);

    return { body: '{ "foo": "bar" }' };
  };

  const result = await asyncOperations.getAsyncOperation({
    prefix,
    query,
    callback,
  });

  t.deepEqual(JSON.parse(result.body), { foo: 'bar' });
});
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

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);

    return Promise.resolve({ body: '{ "foo": "bar" }' });
  };

  const result = await asyncOperations.getAsyncOperation({
    prefix,
    asyncOperationId,
    callback,
  });

  t.deepEqual(JSON.parse(result.body), { foo: 'bar' });
});

test('deleteAsyncOperation calls the callback with the expected object and returns the parsed response', async (t) => {
  const prefix = 'unitTestStack';
  const asyncOperationId = 'id-1234';

  const expected = {
    prefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/asyncOperations/${asyncOperationId}`,
    },
  };
  const resultBody = {
    foo: 'bar',
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);

    return { body: JSON.stringify(resultBody) };
  };

  const result = await asyncOperations.deleteAsyncOperation({
    prefix,
    asyncOperationId,
    callback,
  });

  t.deepEqual(JSON.parse(result.body), resultBody);
});

test('listAsyncOperations calls the callback with the expected object and returns the parsed response', async (t) => {
  const prefix = 'unitTestStack';
  const query = { fake: 'query' };

  const expected = {
    prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/asyncOperations',
      queryStringParameters: query,
    },
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);

    return Promise.resolve({ body: '{ "foo": "bar" }' });
  };

  const result = await asyncOperations.listAsyncOperations({
    prefix,
    query,
    callback,
  });

  t.deepEqual(JSON.parse(result.body), { foo: 'bar' });
});

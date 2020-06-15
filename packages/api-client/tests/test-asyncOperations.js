'use strict';

const test = require('ava');
const rewire = require('rewire');
const asyncOperationsRewire = rewire('../asyncOperations');

test.before(async (t) => {
  t.context.testPrefix = 'unitTestStack';
});

test.serial('getAsyncOperation calls the callback with the expected object and returns the parsed response', async (t) => {
  const asyncOperationId = 'id-1234';

  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/asyncOperations/${asyncOperationId}`
    }
  };

  const callback = async (configObject) => {
    t.deepEqual(expected, configObject);
    return { body: '{ "foo": "bar" }' };
  };

  let revertCallback;
  try {
    revertCallback = asyncOperationsRewire.__set__('invokeApi', callback);
    const result = await asyncOperationsRewire.getAsyncOperation({
      prefix: t.context.testPrefix,
      asyncOperationId
    });
    t.deepEqual(result, { foo: 'bar' });
  } finally {
    revertCallback();
  }
});

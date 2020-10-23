'use strict';

const test = require('ava');

const {
  getMessageAsyncOperationId,
} = require('../AsyncOperations');

test('getMessageAsyncOperationId returns correct async operation ID', (t) => {
  const asyncOperationId = getMessageAsyncOperationId({
    cumulus_meta: {
      asyncOperationId: 'fake-async-id',
    },
  });
  t.is(asyncOperationId, 'fake-async-id');
});

test('getMessageAsyncOperationId returns undefined if there is no async operation ID', (t) => {
  const asyncOperationId = getMessageAsyncOperationId({
    cumulus_meta: {},
  });
  t.is(asyncOperationId, undefined);
});

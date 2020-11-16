'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  getMessageGranules,
  messageHasGranules,
  getGranuleStatus
} = require('../Granules');

const randomId = (prefix) => `${prefix}${cryptoRandomString({ length: 10 })}`;

test('getMessageGranules returns granules from payload.granules', (t) => {
  const granules = [{
    granuleId: randomId('granule'),
  }];
  const testMessage = {
    payload: {
      granules,
    },
  };
  const result = getMessageGranules(testMessage);
  t.deepEqual(result, granules);
});

test('getMessageGranules returns undefined when granules are absent from message', (t) => {
  const testMessage = {};
  const result = getMessageGranules(testMessage);
  t.is(result, undefined);
});

test('messageHasGranules returns true if message has granules', (t) => {
  t.true(messageHasGranules({
    payload: {
      granules: [{
        granuleId: randomId('granule'),
      }],
    },
  }));
});

test('messageHasGranules returns false if message does not have granules', (t) => {
  t.false(messageHasGranules({
    payload: {},
  }));
});

test('getGranuleStatus returns status from message', (t) => {
  t.is(
    getGranuleStatus({
      meta: {
        status: 'running',
      },
    }),
    'running'
  );
});

test('getGranuleStatus returns status from granule', (t) => {
  t.is(
    getGranuleStatus(
      {},
      { status: 'failed' }
    ),
    'failed'
  );
});

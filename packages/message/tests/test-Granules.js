'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  getMessageGranules,
  getGranuleStatus,
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

test('getMessageGranules returns an empty array when granules are absent from message', (t) => {
  const testMessage = {};
  const result = getMessageGranules(testMessage);
  t.deepEqual(result, []);
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

'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { getMessageGranules } = require('../granules');

const randomId = (prefix) => `${prefix}${cryptoRandomString({ length: 10 })}`;

test('getMessageGranules returns granules from payload.granules', (t) => {
  const granules = [{
    granuleId: randomId('granule')
  }];
  const testMessage = {
    payload: {
      granules
    }
  };
  const result = getMessageGranules(testMessage);
  t.deepEqual(result, granules);
});

test('getMessageGranules returns nothing when granules are absent from message', (t) => {
  const testMessage = {};
  const result = getMessageGranules(testMessage);
  t.is(result, undefined);
});

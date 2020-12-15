'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');

const { getMessageCnm, getMessageGranules } = require('../Granules');

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

test('getMessageGranules returns nothing when granules are absent from message', (t) => {
  const testMessage = {};
  const result = getMessageGranules(testMessage);
  t.is(result, undefined);
});

test('getMessageCnm returns cnm or cnmResponse fields', (t) => {
  const testMessage = {};
  let result = getMessageCnm(testMessage);
  t.is(result, undefined);

  testMessage.meta = {
    cnm: {
      submissionTime: '2017-09-30T03:42:29.791198',
      identifier: randomId('id'),
      receivedTime: '2017-12-12T03:53:05.787Z',
      other: randomId('other'),
    },
  };
  result = getMessageCnm(testMessage);
  t.deepEqual(result, omit(testMessage.meta.cnm, ['other']));

  testMessage.meta = {
    cnm: testMessage.meta.cnm,
    cnmResponse: {
      ...testMessage.meta.cnm,
      processCompleteTime: '2017-12-12T03:54:45.238Z',
    },
  };
  result = getMessageCnm(testMessage);
  t.deepEqual(result, omit(testMessage.meta.cnmResponse, ['other']));
});

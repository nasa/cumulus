'use strict';

const test = require('ava');

const {
  getMetaStatus,
} = require('../workflows');

test('getMetaStatus returns correct status', (t) => {
  const status = getMetaStatus({
    meta: {
      status: 'running',
    },
  });
  t.is(status, 'running');
});

test('getMetaStatus returns undefined if there is no status', (t) => {
  const status = getMetaStatus({
    meta: {},
  });
  t.is(status, undefined);
});

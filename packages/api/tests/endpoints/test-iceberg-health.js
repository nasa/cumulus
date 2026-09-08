'use strict';

const test = require('ava');
const rewire = require('rewire');

const { buildFakeExpressResponse } = require('./utils');

const icebergHealth = rewire('../../endpoints/iceberg-health');
const get = icebergHealth.__get__('get');

test.serial('health returns 200 Ready when DuckDB is ready', (t) => {
  const restoreIsDuckDbReady = icebergHealth.__set__('isDuckDbReady', () => true);
  t.teardown(() => {
    restoreIsDuckDbReady();
  });

  const response = buildFakeExpressResponse();
  get({}, response);

  t.true(response.status.calledOnceWith(200));
  t.true(response.status.returnValues[0].send.calledOnceWith('Ready'));
});

test.serial('health returns 503 Initializing when DuckDB is not ready', (t) => {
  const restoreIsDuckDbReady = icebergHealth.__set__('isDuckDbReady', () => false);
  t.teardown(() => {
    restoreIsDuckDbReady();
  });

  const response = buildFakeExpressResponse();
  get({}, response);

  t.true(response.status.calledOnceWith(503));
  t.true(response.status.returnValues[0].send.calledOnceWith('Initializing'));
});

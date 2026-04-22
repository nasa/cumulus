'use strict';

const test = require('ava');
const sinon = require('sinon');
const rewire = require('rewire');

const { buildFakeExpressResponse } = require('./utils');

const icebergStats = rewire('../../endpoints/iceberg-stats');
const summary = icebergStats.__get__('summary');
const aggregate = icebergStats.__get__('aggregate');

test.serial('summary returns badImplementation when StatsIcebergSearch summary query throws', async (t) => {
  const queryError = new Error('summary query failed');
  class MockStatsIcebergSearch {
    async summary() {
      throw queryError;
    }
  }

  const restoreStatsIcebergSearch = icebergStats.__set__('StatsIcebergSearch', MockStatsIcebergSearch);
  const logErrorStub = sinon.stub();
  const restoreLog = icebergStats.__set__('log', { error: logErrorStub });
  t.teardown(() => {
    restoreStatsIcebergSearch();
    restoreLog();
  });

  const response = buildFakeExpressResponse();
  await summary({ query: {} }, response);

  t.true(logErrorStub.calledWith('StatsIcebergSearch Summary Query Failed', queryError));
  t.true(response.boom.badImplementation.calledWith('Error querying S3/Iceberg data'));
  t.true(response.status.notCalled);
  t.true(response.send.notCalled);
});

test.serial('aggregate returns badImplementation when StatsIcebergSearch aggregate query throws', async (t) => {
  const queryError = new Error('aggregate query failed');
  class MockStatsIcebergSearch {
    async aggregate() {
      throw queryError;
    }
  }

  const restoreStatsIcebergSearch = icebergStats.__set__('StatsIcebergSearch', MockStatsIcebergSearch);
  const logErrorStub = sinon.stub();
  const restoreLog = icebergStats.__set__('log', { error: logErrorStub });
  t.teardown(() => {
    restoreStatsIcebergSearch();
    restoreLog();
  });

  const response = buildFakeExpressResponse();
  await aggregate({ params: { type: 'granules' }, query: {} }, response);

  t.true(logErrorStub.calledWith('StatsIcebergSearch Aggregate Query Failed', queryError));
  t.true(response.boom.badImplementation.calledWith('Error querying S3/Iceberg data'));
  t.true(response.status.notCalled);
  t.true(response.send.notCalled);
});

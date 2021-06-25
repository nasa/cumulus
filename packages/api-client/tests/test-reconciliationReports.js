'use strict';

const test = require('ava');

const reconciliationReportApi = require('../reconciliationReports');

test('getReconciliationReport calls the callback with the expected object', async (t) => {
  const name = 'recReport1';
  const expected = {
    prefix: 'recReportTest',
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/reconciliationReports/${name}`,
    },
    expectedStatusCode: 200,
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };
  await t.notThrowsAsync(reconciliationReportApi.getReconciliationReport({
    prefix: expected.prefix,
    name,
    callback,
  }));
});

test('getReconciliationReport calls the callback with the expected status code', async (t) => {
  const expectedStatusCode = 404;
  const name = 'recReport2';
  const expected = {
    prefix: 'recReportTest',
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/reconciliationReports/${name}`,
    },
    expectedStatusCode,
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };
  await t.notThrowsAsync(reconciliationReportApi.getReconciliationReport({
    prefix: expected.prefix,
    name,
    callback,
    expectedStatusCode,
  }));
});

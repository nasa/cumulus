'use strict';

const test = require('ava');

const reconciliationReportApi = require('../reconciliationReports');

test('createReconciliationReport calls the callback with the expected object', async (t) => {
  const request = {
    foo: 'bar',
  };
  const expected = {
    prefix: 'deadLetterArchiveTest',
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/reconciliationReports',
      body: JSON.stringify(request),
    },
    expectedStatusCode: 202,
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };
  await t.notThrowsAsync(reconciliationReportApi.createReconciliationReport({
    prefix: expected.prefix,
    request,
    callback,
  }));
});

test('createReconciliationReport calls the callback with the expected status code', async (t) => {
  const expectedStatusCode = 404;
  const request = {
    foo: 'bar',
  };
  const expected = {
    prefix: 'deadLetterArchiveTest',
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/reconciliationReports',
      body: JSON.stringify(request),
    },
    expectedStatusCode,
  };

  const callback = (configObject) => {
    t.deepEqual(expected, configObject);
  };
  await t.notThrowsAsync(reconciliationReportApi.createReconciliationReport({
    prefix: expected.prefix,
    request,
    callback,
    expectedStatusCode,
  }));
});

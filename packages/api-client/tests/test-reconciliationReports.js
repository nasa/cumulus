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

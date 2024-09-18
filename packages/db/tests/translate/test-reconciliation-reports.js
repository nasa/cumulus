const test = require('ava');
const { randomId } = require('@cumulus/common/test-utils');

const { translatePostgresReconReportToApiReconReport } = require('../../dist/translate/reconciliation_reports');

const pick = require('lodash/pick');

test('translatePostgresReconReportToApiReconReport translates a Postgres Reconciliation Report to an API Reconciliation Report', async(t) => {
  const createdTime = new Date(Date.now());
  const updatedTime = new Date(Date.now());

  const pgReconReport = {
    name: randomId('report'),
    type: 'Granule Inventory',
    status: 'Generated',
    location: 's3://cumulus-test-sandbox-private/reconciliation-reports',
    error: null,
    created_at: createdTime,
    updated_at: updatedTime,
  }

  const expectedApiReconReport = {
    ...pick(pgReconReport, ['name', 'type', 'status', 'location']),
    // no error b/c null or undefined should be removed
    createdAt: createdTime.getTime(),
    updatedAt: updatedTime.getTime(),
  }

  const translatedReport = translatePostgresReconReportToApiReconReport(pgReconReport);

  t.deepEqual(expectedApiReconReport, translatedReport);
});

test('translatePostgresReconReportToApiReconReport translates a error Postgres Reconciliation Report with an error to an API Reconciliation Report', async (t) => {
  const createdTime = new Date(Date.now());
  const updatedTime = new Date(Date.now());

  const pgReconReport = {
    name: randomId('report'),
    type: 'Granule Not Found',
    status: 'Failed',
    location: 's3://cumulus-test-sandbox-private/reconciliation-reports',
    error: {
      Error: 'some error message',
      Cause: 'some error cause',
    },
    created_at: createdTime,
    updated_at: updatedTime,
  }

  const expectedApiReconReport = {
    ...pick(pgReconReport, ['name', 'type', 'status', 'location', 'error']),
    createdAt: createdTime.getTime(),
    updatedAt: updatedTime.getTime(),
  }

  const translatedReport = translatePostgresReconReportToApiReconReport(pgReconReport);

  t.deepEqual(expectedApiReconReport, translatedReport);
});
const test = require('ava');
const { randomId } = require('@cumulus/common/test-utils');
const pick = require('lodash/pick');

const { translatePostgresReconReportToApiReconReport } = require('../../dist/translate/reconciliation_reports');

test('translatePostgresReconReportToApiReconReport translates a Postgres Reconciliation Report to an API Reconciliation Report', (t) => {
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
  };

  const duckDbReconReport = {
    ...pgReconReport,
    created_at: pgReconReport.created_at.toISOString(),
    updated_at: pgReconReport.updated_at.toISOString(),
  };

  const expectedApiReconReport = {
    ...pick(pgReconReport, ['name', 'type', 'status', 'location']),
    // no error b/c null or undefined should be removed
    createdAt: createdTime.getTime(),
    updatedAt: updatedTime.getTime(),
  };

  const translatedReport = translatePostgresReconReportToApiReconReport(pgReconReport);
  t.deepEqual(translatedReport, expectedApiReconReport);

  const duckDbTranslatedReport = translatePostgresReconReportToApiReconReport(duckDbReconReport);
  t.deepEqual(duckDbTranslatedReport, expectedApiReconReport);
});

test('translatePostgresReconReportToApiReconReport translates Postgres Reconciliation Report with an error to an API Reconciliation Report', (t) => {
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
  };

  const duckDbReconReport = {
    ...pgReconReport,
    created_at: pgReconReport.created_at.toISOString(),
    updated_at: pgReconReport.updated_at.toISOString(),
    error: JSON.stringify(pgReconReport.error),
  };

  const expectedApiReconReport = {
    ...pick(pgReconReport, ['name', 'type', 'status', 'location', 'error']),
    createdAt: createdTime.getTime(),
    updatedAt: updatedTime.getTime(),
  };

  const translatedReport = translatePostgresReconReportToApiReconReport(pgReconReport);
  t.deepEqual(translatedReport, expectedApiReconReport);

  const duckDbTranslatedReport = translatePostgresReconReportToApiReconReport(duckDbReconReport);
  t.deepEqual(duckDbTranslatedReport, expectedApiReconReport);
});

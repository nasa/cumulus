import { ApiReconciliationReportRecord } from '@cumulus/types/api/reconciliation_reports';
import { PostgresReconciliationReport, PostgresReconciliationReportRecord } from '../types/reconciliation_report';

const { removeNilProperties } = require('@cumulus/common/util');
const pick = require('lodash/pick');

/**
 * Generate a PostgreSQL Reconciliation Report from an API record.
 *
 * @param record - an API reconciliation report record
 * @returns a PostgreSQL reconciliation report
 */
export const translateApiReconReportToPostgresReconReport = (
  record: ApiReconciliationReportRecord
): PostgresReconciliationReport => {
  const pgReconciliationReport: PostgresReconciliationReport = removeNilProperties({
    ...pick(record, ['name', 'type', 'status', 'location', 'error']),
    created_at: (record.createdAt ? new Date(record.createdAt) : undefined),
    updated_at: (record.updatedAt ? new Date(record.updatedAt) : undefined),
  });
  return pgReconciliationReport;
};

/**
 * Generate an API Reconciliation Report record from a PostgreSQL record.
 *
 * @param pgReconciliationReport - a PostgreSQL reconciliation report record
 * @returns ApiReconciliationReportRecord - an API reconciliation report record
 */
export const translatePostgresReconReportToApiReconReport = (
  pgReconciliationReport: PostgresReconciliationReportRecord
): ApiReconciliationReportRecord => {
  const apiReconciliationReport = removeNilProperties({
    ...pick(pgReconciliationReport, ['name', 'type', 'status', 'location', 'error']),
    createdAt: pgReconciliationReport.created_at?.getTime(),
    updatedAt: pgReconciliationReport.updated_at?.getTime(),
  });
  return apiReconciliationReport;
};

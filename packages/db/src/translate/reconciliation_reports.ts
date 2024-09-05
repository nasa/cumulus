// import Logger from '@cumulus/logger';
import { PostgresReconciliationReportRecord } from '../types/reconciliation_report';

// const log = new Logger({ sender: '@cumulus/db/translate/reconciliation-reports' });

/**
 * Generate an API Reconciliation Report record from a PostgreSQL record.
 * 
 * @param {Object} pgReconciliationReport - a PostgreSQL reconciliation report record
 * @returns {Object} an API reconciliation report record
 */
export const translatePostgresReconciliationReportToApiReconciliationReport = (
  pgReconciliationReport: PostgresReconciliationReportRecord
) => {
  const apiReconciliationReport = {
    // id or cumulus_id?
    name: pgReconciliationReport.name,
    type: pgReconciliationReport.type,
    status: pgReconciliationReport.status,
    location: pgReconciliationReport.location,
    error: pgReconciliationReport.error,
    createdAt: pgReconciliationReport.created_at?.getTime(),
    updatedAt: pgReconciliationReport.updated_at?.getTime(),
  };
  return apiReconciliationReport;
};
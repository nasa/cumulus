import { ApiReconciliationReportRecord } from '@cumulus/types/api/reconciliation_reports';
import { PostgresReconciliationReportRecord } from '../types/reconciliation_report';

const { removeNilProperties } = require('@cumulus/common/util');
const pick = require('lodash/pick');

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

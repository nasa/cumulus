import {
  ReconciliationReportType,
  ReconciliationReportStatus,
} from '@cumulus/types/api/reconciliation_reports';

/**
 * PostgresReconciliationReport
 *
 * This interface describes a Reconciliation Report object in postgres compatible format that
 * is ready for write to Cumulus's postgres database instance
 */

export interface PostgresReconciliationReport {
  name: string,
  type: ReconciliationReportType,
  status: ReconciliationReportStatus,
  location?: string,
  error?: object,
  created_at?: Date,
  updated_at?: Date,
}

/**
 * PostgresReconciliationReportRecord
 *
 * This interface describes a Reconciliation Report Record that has been retrieved from
 * postgres for reading.  It differs from the PostgresReconciliationReport interface in that
 * it types the autogenerated/required fields in the Postgres database as required
 */
export interface PostgresReconciliationReportRecord extends PostgresReconciliationReport {
  cumulus_id: number,
  created_at: Date,
  updated_at: Date
}
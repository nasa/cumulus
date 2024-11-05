export type ReconciliationReportType =
  'Granule Inventory' | 'Granule Not Found' | 'Internal' | 'Inventory' | 'ORCA Backup';
export type ReconciliationReportStatus = 'Generated' | 'Pending' | 'Failed';

export interface ApiReconciliationReport {
  name: string,
  type: ReconciliationReportType,
  status: ReconciliationReportStatus,
  location?: string,
  error?: object,
  createdAt?: number,
  updatedAt?: number,
}

export interface ApiReconciliationReportRecord extends ApiReconciliationReport {
  createdAt: number,
  updatedAt: number,
}

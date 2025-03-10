import { Knex } from 'knex';
import { BasePgModel } from './base';
import { TableNames } from '../tables';

import {
  PostgresReconciliationReport,
  PostgresReconciliationReportRecord,
} from '../types/reconciliation_report';

// eslint-disable-next-line max-len
class ReconciliationReportPgModel extends BasePgModel<PostgresReconciliationReport, PostgresReconciliationReportRecord> {
  constructor() {
    super({
      tableName: TableNames.reconciliationReports,
    });
  }

  create(
    knexOrTransaction: Knex | Knex.Transaction,
    item: PostgresReconciliationReport
  ): Promise<PostgresReconciliationReportRecord[]> {
    return super.create(knexOrTransaction, item, '*') as Promise<PostgresReconciliationReportRecord[]>;
  }

  upsert(
    knexOrTransaction: Knex | Knex.Transaction,
    reconciliationReport: PostgresReconciliationReport
  ): Promise<PostgresReconciliationReportRecord[]> {
    return knexOrTransaction(this.tableName)
      .insert(reconciliationReport)
      .onConflict('name')
      .merge()
      .returning('*');
  }
}

export { ReconciliationReportPgModel };

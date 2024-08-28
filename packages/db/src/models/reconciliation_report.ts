import { Knex } from 'knex';
import { BasePgModel } from './base';
import { TableNames } from '../tables';

import { PostgresReconciliationReport, PostgresReconciliationReportRecord } from '../types/reconciliation_report';

class ReconciliationReportPgModel extends BasePgModel<PostgresReconciliationReport, PostgresReconciliationReportRecord> {
  constructor() {
    super({
      tableName: TableNames.reconciliationReports,
    });
  }

  create(
    knexOrTransaction: Knex | Knex.Transaction,
    item: PostgresReconciliationReport
  ) {
    return super.create(knexOrTransaction, item, '*');
  }

  upsert(
    knexOrTransaction: Knex | Knex.Transaction,
    reconciliationReport: PostgresReconciliationReport
  ) {
    return knexOrTransaction(this.tableName)
      .insert(reconciliationReport)
      .onConflict('name')
      .merge()
      .returning('*');
  }
}

export { ReconciliationReportPgModel };

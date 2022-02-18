import { Knex } from 'knex';
import { BasePgModel } from './base';
import { TableNames } from '../tables';

import { PostgresRule, PostgresRuleRecord } from '../types/rule';

class RulePgModel extends BasePgModel<PostgresRule, PostgresRuleRecord> {
  constructor() {
    super({
      tableName: TableNames.rules,
    });
  }

  upsert(
    knexOrTransaction: Knex | Knex.Transaction,
    rule: PostgresRule,
    fieldsToDelete: (keyof PostgresRule)[] = []
  ) {
    const deleteFieldKeys = Object.fromEntries(fieldsToDelete.map(
      (fieldKey) => [fieldKey, undefined]
    ));
    const upsertRule = {
      ...rule,
      ...deleteFieldKeys,
    };
    return knexOrTransaction(this.tableName)
      .insert(upsertRule)
      .onConflict('name')
      .merge()
      .returning('cumulus_id');
  }
}

export { RulePgModel };

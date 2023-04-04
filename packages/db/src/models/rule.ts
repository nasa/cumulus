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

  create(
    knexOrTransaction: Knex | Knex.Transaction,
    item: PostgresRule
  ) {
    return super.create(knexOrTransaction, item, '*');
  }

  upsert(
    knexOrTransaction: Knex | Knex.Transaction,
    rule: PostgresRule
  ) {
    return knexOrTransaction(this.tableName)
      .insert(rule)
      .onConflict('name')
      .merge()
      .returning('*');
  }
}

export { RulePgModel };

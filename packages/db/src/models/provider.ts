import { Knex } from 'knex';

import { BasePgModel } from './base';
import { TableNames } from '../tables';

import { PostgresProvider, PostgresProviderRecord } from '../types/provider';

class ProviderPgModel extends BasePgModel<PostgresProvider, PostgresProviderRecord> {
  constructor() {
    super({
      tableName: TableNames.providers,
    });
  }

  upsert(
    knexOrTransaction: Knex | Knex.Transaction,
    provider: PostgresProvider
  ) {
    return knexOrTransaction(this.tableName)
      .insert(provider)
      .onConflict('name')
      .merge()
      .returning('*');
  }
}

export { ProviderPgModel };

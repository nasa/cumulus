import Knex from 'knex';

import { BasePgModel } from './base';
import { tableNames } from '../tables';

import { PostgresProvider, PostgresProviderRecord } from '../types/provider';

class ProviderPgModel extends BasePgModel<PostgresProvider, PostgresProviderRecord> {
  constructor() {
    super({
      tableName: tableNames.providers,
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
      .returning('cumulus_id');
  }
}

export { ProviderPgModel };

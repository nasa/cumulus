import { Knex } from 'knex';

import { BasePgModel } from './base';
import { TableNames } from '../tables';

import { PostgresCollection, PostgresCollectionRecord } from '../types/collection';

class CollectionPgModel extends BasePgModel<PostgresCollection, PostgresCollectionRecord> {
  constructor() {
    super({
      tableName: TableNames.collections,
    });
  }

  create(
    knexOrTransaction: Knex | Knex.Transaction,
    item: PostgresCollection
  ) {
    return super.create(knexOrTransaction, item, '*');
  }

  upsert(
    knexOrTransaction: Knex | Knex.Transaction,
    collection: PostgresCollection
  ) {
    return knexOrTransaction(this.tableName)
      .insert(collection)
      .onConflict(['name', 'version'])
      .merge()
      .returning('*');
  }
  async getMetricsAndCmrProvider(
    knexOrTransaction: Knex | Knex.Transaction,
    collectionCumulusId: number
  ): Promise<{ metrics_provider: string, cmr_provider: string }> {
    return super.get(
      knexOrTransaction,
      { cumulus_id: collectionCumulusId },
      ['metrics_provider', 'cmr_provider']
    );
  }
}

export { CollectionPgModel };

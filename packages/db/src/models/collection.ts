import Knex from 'knex';

import { BasePgModel } from './base';
import { tableNames } from '../tables';

import { PostgresCollection, PostgresCollectionRecord } from '../types/collection';

class CollectionPgModel extends BasePgModel<PostgresCollection, PostgresCollectionRecord> {
  constructor() {
    super({
      tableName: tableNames.collections,
    });
  }
  async create(
    knexOrTransaction: Knex | Knex.Transaction,
    item: PostgresCollection
  ): Promise<number[]> {
    return await knexOrTransaction(this.tableName)
      .insert(item)
      .returning('*');
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
}

export { CollectionPgModel };

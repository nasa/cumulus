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

  upsert(
    knexOrTrx: Knex | Knex.Transaction,
    collection: PostgresCollection
  ) {
    return knexOrTrx(this.tableName)
      .insert(collection)
      .onConflict(['name', 'version'])
      .merge();
  }
}

export { CollectionPgModel };

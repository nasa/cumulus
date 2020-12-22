import { BasePgModel } from './base';
import { tableNames } from '../tables';

import { PostgresCollection, PostgresCollectionRecord } from '../types/collection';

class CollectionPgModel extends BasePgModel<PostgresCollection, PostgresCollectionRecord> {
  constructor() {
    super({
      tableName: tableNames.collections,
    });
  }
}

export { CollectionPgModel };

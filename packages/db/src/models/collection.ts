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
      .returning([
        'cumulus_id',
        'name',
        'version',
        'sample_file_name',
        'granule_id_validation_regex',
        'granule_id_extraction_regex',
        'files',
        'process',
        'url_path',
        'duplicate_handling',
        'report_to_ems',
        'ignore_files_config_for_discovery',
        'meta',
        'tags',
        'created_at',
        'updated_at',
      ]);
  }

  upsert(
    knexOrTransaction: Knex | Knex.Transaction,
    collection: PostgresCollection
  ) {
    return knexOrTransaction(this.tableName)
      .insert(collection)
      .onConflict(['name', 'version'])
      .merge()
      .returning([
        'cumulus_id',
        'name',
        'version',
        'sample_file_name',
        'granule_id_validation_regex',
        'granule_id_extraction_regex',
        'files',
        'process',
        'url_path',
        'duplicate_handling',
        'report_to_ems',
        'ignore_files_config_for_discovery',
        'meta',
        'tags',
        'created_at',
        'updated_at',
      ]);
  }
}

export { CollectionPgModel };

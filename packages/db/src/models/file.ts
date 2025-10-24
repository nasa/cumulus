import { Knex } from 'knex';

import { BasePgModel } from './base';
import { TableNames } from '../tables';

import { PostgresFile, PostgresFileRecord } from '../types/file';

class FilePgModel extends BasePgModel<PostgresFile, PostgresFileRecord> {
  constructor() {
    super({
      tableName: TableNames.files,
    });
  }

  upsert(
    knexOrTrx: Knex | Knex.Transaction,
    input: PostgresFile | PostgresFile[]
  ): Promise<PostgresFileRecord[]> {
    const files = Array.isArray(input) ? input : [input];

    if (files.length === 0) return Promise.resolve([]);

    return knexOrTrx(this.tableName)
      .insert(files)
      .onConflict(['bucket', 'key'])
      .merge()
      .returning('*');
  }

  /**
   * Retrieves all files for all granules given
  */
  searchByGranuleCumulusIds(
    knexOrTrx: Knex | Knex.Transaction,
    granule_cumulus_ids: number[],
    columns: string | string[] = '*'
  ): Promise<PostgresFileRecord[]> {
    return knexOrTrx(this.tableName)
      .select(columns)
      .whereIn('granule_cumulus_id', granule_cumulus_ids);
  }
}

export { FilePgModel };

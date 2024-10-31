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
    file: PostgresFile
  ) {
    return knexOrTrx(this.tableName)
      .insert(file)
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
    returning: string = '*'
  ): Promise<PostgresFileRecord[]> {
    return knexOrTrx(this.tableName)
      .whereIn('granule_cumulus_id', granule_cumulus_ids)
      .returning(returning);
  }
}

export { FilePgModel };

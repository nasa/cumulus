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

  async upsert(
    knexOrTrx: Knex | Knex.Transaction,
    input: PostgresFile | PostgresFile[]
  ): Promise<PostgresFileRecord[]> {
    const files = Array.isArray(input) ? input : [input];
    if (files.length === 0) return [];

    // Try a standard insert first (fastest path)
    try {
      return await knexOrTrx(this.tableName)
        .insert(files)
        .returning('*');
    } catch (error: any) {
      // Catch the unique_violation (23505) thrown the trigger
      if (error.code === '23505') {
        return await knexOrTrx.transaction(async (trx) => {
          const results: PostgresFileRecord[] = [];
          for (const file of files) {
            // Fallback: try update first, insert if not found
            // eslint-disable-next-line no-await-in-loop
            const updated = await trx(this.tableName)
              .where({
                bucket: file.bucket,
                key: file.key,
                collection_cumulus_id: file.collection_cumulus_id,
              })
              .update(file)
              .returning('*');

            if (updated.length > 0) {
              results.push(...updated);
            } else {
              // If the row doesn't exist yet, insert it
              // eslint-disable-next-line no-await-in-loop
              const inserted = await trx(this.tableName)
                .insert(file)
                .returning('*');
              results.push(...inserted);
            }
          }
          return results;
        });
      }
      throw error;
    }
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

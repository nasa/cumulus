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
   * Updates one or multiple files by cumulus_id
   */
  async updateFilesById(
    knexOrTrx: Knex | Knex.Transaction,
    input: Partial<PostgresFileRecord> | Partial<PostgresFileRecord>[]
  ): Promise<PostgresFileRecord[]> {
    const files = Array.isArray(input) ? input : [input];

    if (files.length === 0) return Promise.resolve([]);

    const results: PostgresFileRecord[] = [];

    for (const file of files) {
      const { cumulus_id: cumulusId, ...updates } = file;

      if (!cumulusId) {
        throw new Error('cumulus_id is required to update a file');
      }

      if (Object.keys(updates).length > 0) {
        // eslint-disable-next-line no-await-in-loop
        const [updated] = await knexOrTrx(this.tableName)
          .where({ cumulus_id: cumulusId })
          .update(updates)
          .returning('*');

        if (!updated) {
          throw new Error(`File not found with cumulus_id=${cumulusId}`);
        }

        results.push(updated);
      }
    }

    return results;
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

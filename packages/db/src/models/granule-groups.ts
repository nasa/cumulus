import { Knex } from 'knex';

import { TableNames } from '../tables';
import { BasePgModel } from './base';

import { PostgresGranuleGroup, PostgresGranuleGroupRecord } from '../types/granule-group';

// eslint-disable-next-line max-len
export default class GranuleGroupsPgModel extends BasePgModel<PostgresGranuleGroup, PostgresGranuleGroupRecord> {
  constructor() {
    super({
      tableName: TableNames.granuleGroups,
    });
  }

  /**
   * Creates or updates a granule_group record in postgres
   *
   * @param {Knex | Knex.Transaction} knexOrTrx - DB client or transaction
   * @param {Partial<PostgresGranuleGroup>} item - postgres granule group object to write or create
   * @returns {Promise<PostgresGranuleGroup[]>} List of returned records
   */
  upsert(
    knexOrTrx: Knex | Knex.Transaction,
    item: PostgresGranuleGroup
  ) {
    try {
      return knexOrTrx(this.tableName)
        .insert(item)
        .onConflict(['granule_cumulus_id'])
        .merge()
        .returning('*');
    } catch (error: any) {
      throw new Error(`Failed to upsert granuleGroups record: ${error.message}`);
    }
  }

  /**
   * Retrieves all granule_groups for the given granules' cumulus_ids
   *
   * @param {Knex | Knex.Transaction} knexOrTrx - DB client or transaction
   * @param {Number[]} granule_cumulus_ids - postgres granule_cumulus_ids of granule_groups
   * @returns {Promise<Partial<PostgresGranuleGroup[]>>} List of returned records
   */
  searchByGranuleCumulusIds(
    knexOrTrx: Knex | Knex.Transaction,
    granule_cumulus_ids: number[],
    columns: string | string[] = '*'
  ): Promise<PostgresGranuleGroupRecord[]> {
    return knexOrTrx(this.tableName)
      .select(columns)
      .whereIn('granule_cumulus_id', granule_cumulus_ids);
  }
}

export { GranuleGroupsPgModel };

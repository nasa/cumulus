import Knex from 'knex';

import { tableNames } from '../tables';

import { PostgresGranule, PostgresGranuleRecord, PostgresGranuleUniqueColumns } from '../types/granule';

import { BasePgModel } from './base';
import { GranulesExecutionsPgModel } from './granules-executions';

export default class GranulePgModel extends BasePgModel<PostgresGranule, PostgresGranuleRecord> {
  constructor() {
    super({
      tableName: tableNames.granules,
    });
  }

  /**
   * Deletes the item from Postgres
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction - DB client or transaction
   * @param {Partial<RecordType>} params - An object or any portion of an object of type RecordType
   * @returns {Promise<number>} The number of rows deleted
   */
  async delete(
    knexOrTransaction: Knex | Knex.Transaction,
    params: PostgresGranuleUniqueColumns | { cumulus_id: number }
  ): Promise<number> {
    return knexOrTransaction(this.tableName)
      .where(params)
      .del();
  }

  async upsert(
    knexOrTrx: Knex | Knex.Transaction,
    granule: PostgresGranule,
    executionCumulusId: number,
    granulesExecutionsPgModel = new GranulesExecutionsPgModel()
  ) {
    if (granule.status === 'running') {
      return knexOrTrx(this.tableName)
        .insert(granule)
        .onConflict(['granule_id', 'collection_cumulus_id'])
        .merge({
          status: granule.status,
          timestamp: granule.timestamp,
          updated_at: granule.updated_at,
        })
        // Only do the upsert if there IS NOT already a record associating
        // the granule to this execution. If there IS already a record
        // linking this granule to this execution, then this upsert query
        // will not affect any rows.
        .whereNotExists(
          granulesExecutionsPgModel.search(
            knexOrTrx,
            { execution_cumulus_id: executionCumulusId }
          )
        )
        .returning('cumulus_id');
    }
    return knexOrTrx(this.tableName)
      .insert(granule)
      .onConflict(['granule_id', 'collection_cumulus_id'])
      .merge()
      .returning('cumulus_id');
  }
}

export { GranulePgModel };

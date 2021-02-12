import Knex from 'knex';

import { BasePgModel } from './base';
import { tableNames } from '../tables';

import { PostgresGranule, PostgresGranuleRecord } from '../types/granule';

export default class GranulePgModel extends BasePgModel<PostgresGranule, PostgresGranuleRecord> {
  constructor() {
    super({
      tableName: tableNames.granules,
    });
  }

  async createWithExecutionHistory(
    knexOrTrx: Knex | Knex.Transaction,
    item: PostgresGranule,
    executionCumulusId: number
  ) {
    const [granuleCumulusId] = await this.create(knexOrTrx, item);
    await knexOrTrx(tableNames.granuleExecutionsHistory)
      .insert({
        granule_cumulus_id: granuleCumulusId,
        execution_cumulus_id: executionCumulusId,
      });
    return granuleCumulusId;
  }

  getWithExecutionHistory(
    knexOrTransaction: Knex | Knex.Transaction,
    granule: Partial<PostgresGranuleRecord>
  ) {
    return knexOrTransaction(this.tableName)
      .where(granule)
      .join(
        tableNames.granuleExecutionsHistory,
        // is this open to SQL injection?
        `${this.tableName}.cumulus_id`,
        '=',
        `${tableNames.granuleExecutionsHistory}.granule_cumulus_id`
      )
      .select(`${this.tableName}.*`, `${tableNames.granuleExecutionsHistory}.*`);
  }

  async upsert(
    knexOrTrx: Knex | Knex.Transaction,
    granule: PostgresGranule,
    executionCumulusId: number
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
        // Only do the upsert IF there is not already a record associating
        // the granule to this execution
        // TODO: test if there are multiple granules
        .whereNotExists(
          // `${this.tableName}.execution_cumulus_id != EXCLUDED.execution_cumulus_id`
          knexOrTrx(tableNames.granuleExecutionsHistory)
            .where('execution_cumulus_id', '=', executionCumulusId)
        )
        .returning('cumulus_id');
    }
    return knexOrTrx(this.tableName)
      .insert(granule)
      .onConflict(['granule_id', 'collection_cumulus_id'])
      .merge()
      .returning('cumulus_id');
  }

  async upsertWithExecutionHistory(
    knexOrTrx: Knex | Knex.Transaction,
    granule: PostgresGranule,
    executionCumulusId: number
  ) {
    // TODO: test what happens if upsert does not affect any rows
    const [granuleCumulusId] = await this.upsert(knexOrTrx, granule, executionCumulusId);
    return knexOrTrx(tableNames.granuleExecutionsHistory)
      .insert({
        granule_cumulus_id: granuleCumulusId,
        execution_cumulus_id: executionCumulusId,
      })
      .onConflict(['granule_cumulus_id', 'execution_cumulus_id'])
      .merge();
  }
}

export { GranulePgModel };

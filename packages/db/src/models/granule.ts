import Knex from 'knex';

import { BasePgModel } from './base';
import { tableNames } from '../tables';

import { PostgresGranule, PostgresGranuleRecord } from '../types/granule';

import { GranuleExecutionHistoryPgModel } from './granule-execution-history';

export default class GranulePgModel extends BasePgModel<PostgresGranule, PostgresGranuleRecord> {
  constructor() {
    super({
      tableName: tableNames.granules,
    });
  }

  async createWithExecutionHistory(
    knexOrTrx: Knex | Knex.Transaction,
    item: PostgresGranule,
    executionCumulusId: number,
    granuleExecutionHistoryPgModel = new GranuleExecutionHistoryPgModel()
  ) {
    const [granuleCumulusId] = await this.create(knexOrTrx, item);
    await granuleExecutionHistoryPgModel.create(
      knexOrTrx,
      {
        granule_cumulus_id: granuleCumulusId,
        execution_cumulus_id: executionCumulusId,
      }
    );
    return [granuleCumulusId];
  }

  getWithExecutionHistory(
    knexOrTransaction: Knex | Knex.Transaction,
    granule: Partial<PostgresGranuleRecord>
  ) {
    // TODO: is this open to SQL injection?
    return knexOrTransaction(this.tableName)
      .where(granule)
      .join(
        tableNames.granulesExecutions,
        `${this.tableName}.cumulus_id`,
        '=',
        `${tableNames.granulesExecutions}.granule_cumulus_id`
      )
      .column(`${this.tableName}.*`)
      .column(
        knexOrTransaction.raw(`array_agg(${tableNames.granulesExecutions}.execution_cumulus_id) as execution_cumulus_ids`)
      )
      .groupBy('cumulus_id');
  }

  async upsert(
    knexOrTrx: Knex | Knex.Transaction,
    granule: PostgresGranule,
    executionCumulusId: number,
    granuleExecutionHistoryPgModel = new GranuleExecutionHistoryPgModel()
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
          // TODO: this effectively makes executions required for granules
          // at write time. Is that okay?
          granuleExecutionHistoryPgModel.search(
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

  async upsertWithExecutionHistory(
    knexOrTrx: Knex | Knex.Transaction,
    granule: PostgresGranule,
    executionCumulusId: number,
    granuleExecutionHistoryPgModel = new GranuleExecutionHistoryPgModel()
  ): Promise<number[]> {
    const [granuleCumulusId] = await this.upsert(knexOrTrx, granule, executionCumulusId);
    // granuleCumulusId could be undefined if the upsert affected no rows due to its
    // conditional logic. In that case, we assume that the executino history for the
    // granule was already written and return early. Execution history cannot be written
    // without granuleCumulusId regardless.
    if (!granuleCumulusId) {
      return [];
    }
    await granuleExecutionHistoryPgModel.upsert(
      knexOrTrx,
      {
        granule_cumulus_id: granuleCumulusId,
        execution_cumulus_id: executionCumulusId,
      }
    );
    return [granuleCumulusId];
  }
}

export { GranulePgModel };

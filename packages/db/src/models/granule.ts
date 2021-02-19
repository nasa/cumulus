import Knex from 'knex';

import { tableNames } from '../tables';

import { PostgresGranule, PostgresGranuleRecord } from '../types/granule';

import { BasePgModel } from './base';
import { GranulesExecutionsPgModel } from './granules-executions';

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
    granulesExecutionsPgModel = new GranulesExecutionsPgModel()
  ) {
    const [granuleCumulusId] = await this.create(knexOrTrx, item);
    await granulesExecutionsPgModel.create(
      knexOrTrx,
      {
        granule_cumulus_id: granuleCumulusId,
        execution_cumulus_id: executionCumulusId,
      }
    );
    return [granuleCumulusId];
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
          // TODO: this effectively makes executions required for granules
          // at write time. Is that okay?
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

  async upsertWithExecutionHistory(
    knexOrTrx: Knex | Knex.Transaction,
    granule: PostgresGranule,
    executionCumulusId: number,
    granulesExecutionsPgModel = new GranulesExecutionsPgModel()
  ): Promise<number[]> {
    const [granuleCumulusId] = await this.upsert(knexOrTrx, granule, executionCumulusId);
    // granuleCumulusId could be undefined if the upsert affected no rows due to its
    // conditional logic. In that case, we assume that the executino history for the
    // granule was already written and return early. Execution history cannot be written
    // without granuleCumulusId regardless.
    if (!granuleCumulusId) {
      return [];
    }
    await granulesExecutionsPgModel.upsert(
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

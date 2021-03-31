import Knex from 'knex';

import { tableNames } from '../tables';

import { PostgresGranule, PostgresGranuleRecord } from '../types/granule';

import { BasePgModel } from './base';
import { GranulesExecutionsPgModel } from './granules-executions';
import { translateDateToUTC } from '../lib/timestamp';

export default class GranulePgModel extends BasePgModel<PostgresGranule, PostgresGranuleRecord> {
  constructor() {
    super({
      tableName: tableNames.granules,
    });
  }

  async upsert(
    knexOrTrx: Knex | Knex.Transaction,
    granule: PostgresGranule,
    executionCumulusId: number,
    granulesExecutionsPgModel = new GranulesExecutionsPgModel()
  ) {
    if (!granule.created_at) {
      throw new Error(`To upsert granule record must have 'created_at' set: ${JSON.stringify(granule)}`);
    }
    if (granule.status === 'running') {
      const existing = granulesExecutionsPgModel.search(
        knexOrTrx,
        { execution_cumulus_id: executionCumulusId }
      );

      const existingR = await granulesExecutionsPgModel.search(
        knexOrTrx,
        { execution_cumulus_id: executionCumulusId }
      );
      console.log(existing);
      console.log(existingR);

      return knexOrTrx(this.tableName)
        .insert(granule)
        .onConflict(['granule_id', 'collection_cumulus_id'])
        .merge({
          status: granule.status,
          timestamp: granule.timestamp,
          updated_at: granule.updated_at,
          created_at: granule.created_at,
        })
        .where(knexOrTrx.raw(`${this.tableName}.created_at <= to_timestamp(${translateDateToUTC(granule.created_at)})`))
        // Only do the upsert if there IS NOT already a record associating
        // the granule to this execution. If there IS already a record
        // linking this granule to this execution, then this upsert query
        // will not affect any rows.
        // .whereNotExists(
        //   existing
        // )
        .returning('cumulus_id');
    }
    return knexOrTrx(this.tableName)
      .insert(granule)
      .onConflict(['granule_id', 'collection_cumulus_id'])
      .merge()
      .where(knexOrTrx.raw(`${this.tableName}.created_at <= to_timestamp(${translateDateToUTC(granule.created_at)})`))
      .returning('cumulus_id');
  }
}

export { GranulePgModel };

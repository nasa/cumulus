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

  upsert(
    knexOrTrx: Knex | Knex.Transaction,
    granule: PostgresGranule
  ) {
    return knexOrTrx(this.tableName)
      .insert(granule)
      .onConflict(['granule_id', 'collection_cumulus_id'])
      .merge({
        execution_cumulus_id: granule.execution_cumulus_id,
        status: granule.status,
        timestamp: granule.timestamp,
        updated_at: granule.updated_at,
      })
      .where(`${this.tableName}.execution_cumulus_id`, granule.execution_cumulus_id)
      .returning('cumulus_id');
  }
}

export { GranulePgModel };

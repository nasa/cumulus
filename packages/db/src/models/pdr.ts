import Knex from 'knex';

import { BasePgModel } from './base';
import { tableNames } from '../tables';

import { PostgresPdr, PostgresPdrRecord } from '../types/pdr';

export default class PdrPgModel extends BasePgModel<PostgresPdr, PostgresPdrRecord> {
  constructor() {
    super({
      tableName: tableNames.granules,
    });
  }

  upsert(
    knexOrTrx: Knex | Knex.Transaction,
    granule: PostgresGranule
  ) {
    if (granule.status === 'running') {
      return knexOrTrx(this.tableName)
        .insert(granule)
        .onConflict(['granule_id', 'collection_cumulus_id'])
        .merge({
          execution_cumulus_id: granule.execution_cumulus_id,
          status: granule.status,
          timestamp: granule.timestamp,
          updated_at: granule.updated_at,
        })
        // execution_cumulus_id is not required, so granule.execution_cumulus_id may be
        // undefined. so need to compare against EXCLUDED.execution_cumulus_id
        .whereRaw(`${this.tableName}.execution_cumulus_id != EXCLUDED.execution_cumulus_id`)
        .returning('cumulus_id');
    }
    return knexOrTrx(this.tableName)
      .insert(granule)
      .onConflict(['granule_id', 'collection_cumulus_id'])
      .merge()
      .returning('cumulus_id');
  }
}

export { PdrPgModel };

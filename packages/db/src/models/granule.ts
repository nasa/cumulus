import Knex from 'knex';
import { DeletePublishedGranule } from '@cumulus/errors';

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

  delete(
    knexOrTransaction: Knex | Knex.Transaction,
    granule: PostgresGranule
  ) {
    if (granule.published) {
      throw new DeletePublishedGranule('You cannot delete a granule that is published to CMR. Remove it from CMR first');
    }
    // TODO Delete granule files

    // TODO double-check that this is ok. granule_id is not the pk
    return super.delete(knexOrTransaction, { granule_id: granule.granule_id });
  }
}

export { GranulePgModel };

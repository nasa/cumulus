import Knex from 'knex';

import { BasePgModel } from './base';
import { tableNames } from '../tables';

import { PostgresPdr, PostgresPdrRecord } from '../types/pdr';

export default class PdrPgModel extends BasePgModel<PostgresPdr, PostgresPdrRecord> {
  constructor() {
    super({
      tableName: tableNames.pdrs,
    });
  }

  async upsert(
    knexOrTrx: Knex | Knex.Transaction,
    pdr: PostgresPdrRecord
  ) {
    if (pdr.status === 'running') {
      return knexOrTrx(this.tableName)
        .insert(pdr)
        .onConflict('name')
        .merge()
        .where('pdrs.execution_cumulus_id', '!=', pdr.execution_cumulus_id)
        .orWhere('pdrs.progress', '<', pdr.progress)
        .returning('cumulus_id');
    }
    return knexOrTrx(this.tableName)
      .insert(pdr)
      .onConflict('name')
      .merge()
      .returning('cumulus_id');
  }
}

export { PdrPgModel };

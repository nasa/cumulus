import { Knex } from 'knex';

import { BasePgModel } from './base';
import { TableNames } from '../tables';

import { convertRecordsIdFieldsToNumber } from '../lib/typeHelpers';
import { PostgresPdr, PostgresPdrRecord } from '../types/pdr';
import { translateDateToUTC } from '../lib/timestamp';

export default class PdrPgModel extends BasePgModel<PostgresPdr, PostgresPdrRecord> {
  constructor() {
    super({
      tableName: TableNames.pdrs,
    });
  }

  async upsert(
    knexOrTrx: Knex | Knex.Transaction,
    pdr: PostgresPdr
  ) {
    if (!pdr.created_at) {
      throw new Error(`To upsert pdr record must have 'created_at' set: ${JSON.stringify(pdr)}`);
    }
    if (pdr.status === 'running') {
      return await knexOrTrx(this.tableName)
        .insert(pdr)
        .onConflict('name')
        .merge()
        // progress is not a required field, so trying to use `pdr.progress`
        // as where clause value throws a TS error
        .where(knexOrTrx.raw(`${this.tableName}.created_at <= to_timestamp(${translateDateToUTC(pdr.created_at)})`))
        .andWhere((qb: Knex.QueryBuilder) => {
          qb.where(knexOrTrx.raw(`${this.tableName}.execution_cumulus_id != EXCLUDED.execution_cumulus_id`))
            .orWhere(knexOrTrx.raw(`${this.tableName}.progress < EXCLUDED.progress`));
        })
        .returning('*');
    }
    const result = await knexOrTrx(this.tableName)
      .insert(pdr)
      .onConflict('name')
      .merge()
      .where(knexOrTrx.raw(`${this.tableName}.created_at <= to_timestamp(${translateDateToUTC(pdr.created_at)})`))
      .returning('*');
    return convertRecordsIdFieldsToNumber(result);
  }
}

export { PdrPgModel };

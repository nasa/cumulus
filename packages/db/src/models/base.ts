import Knex from 'knex';

import { tableNames } from '../tables';

import { isRecordDefined } from '../database';

class BasePgModel<RecordType> {
  readonly tableName: tableNames;

  constructor({
    tableName,
  }: {
    tableName: tableNames,
  }) {
    this.tableName = tableName;
  }

  get(
    knexOrTrx: Knex | Knex.Transaction,
    params: Partial<RecordType>
  ) {
    return knexOrTrx<RecordType>(this.tableName).where(params).first();
  }

  async exists(
    knexOrTrx: Knex | Knex.Transaction,
    params: Partial<RecordType>
  ): Promise<boolean> {
    return isRecordDefined(await this.get(knexOrTrx, params));
  }
}

export { BasePgModel };

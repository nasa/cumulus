import Knex from 'knex';

import { RecordDoesNotExist } from '@cumulus/errors';

import { tableNames } from '../tables';

import { isRecordDefined } from '../database';

class BasePgModel<ItemType, RecordType extends { cumulus_id: number }> {
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

  async getRecordCumulusId(
    knexOrTrx: Knex|Knex.Transaction,
    whereClause : Partial<RecordType>
  ): Promise<number> {
    const record: RecordType = await knexOrTrx(this.tableName)
      .select('cumulus_id')
      .where(whereClause)
      .first();
    if (!isRecordDefined(record)) {
      throw new RecordDoesNotExist(`Record in ${this.tableName} with identifiers ${JSON.stringify(whereClause)} does not exist.`);
    }
    return record.cumulus_id;
  }

  async exists(
    knexOrTrx: Knex | Knex.Transaction,
    params: Partial<RecordType>
  ): Promise<boolean> {
    return isRecordDefined(await this.get(knexOrTrx, params));
  }

  create(
    knexOrTrx: Knex | Knex.Transaction,
    item: ItemType
  ) {
    return knexOrTrx(this.tableName)
      .insert(item)
      .returning('cumulus_id');
  }
}

export { BasePgModel };

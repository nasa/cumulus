import { Knex } from 'knex';

import { isRecordDefined } from '../database';
import { TableNames } from '../tables';

import { PostgresGranuleDuplicate } from '../types/granule-duplicate';

export default class GranulesDuplicatesPgModel {
  readonly tableName: TableNames;

  // can't extend base class because type for this data doesn't contain
  // a cumulus_id property
  constructor() {
    this.tableName = TableNames.granuleDuplicates;
  }

  async create(
    knexTransaction: Knex | Knex.Transaction,
    item: PostgresGranuleDuplicate
  ) {
    return await knexTransaction(this.tableName).insert(item);
  }

  async exists(
    knexTransaction: Knex | Knex.Transaction,
    item: PostgresGranuleDuplicate
  ) {
    return isRecordDefined(await knexTransaction(this.tableName).where(item).first());
  }

  async upsert(
    knexTransaction: Knex | Knex.Transaction,
    item: PostgresGranuleDuplicate
  ) {
    return await knexTransaction(this.tableName)
      .insert(item)
      .onConflict(['granule_cumulus_id', 'group_id'])
      .merge()
      .returning('*');
  }
  /**
   * Creates multiple granuleExecutions in Postgres
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction - DB client or transaction
   * @param {PostgresGranuleExecution[]} items - Records to insert into the DB
   * @param {string | Array<string>} returningFields - A string or array of strings
   *   of columns to return. Defaults to 'cumulus_id'.
   * @returns {Promise<PostgresGranuleExecution[]>} Returns an array of objects
   *   from the specified column(s) from returningFields.
   */
  async insert(
    knexOrTransaction: Knex | Knex.Transaction,
    items: PostgresGranuleDuplicate[],
    returningFields: string | string[] = '*'
  ): Promise<PostgresGranuleDuplicate[]> {
    return await knexOrTransaction(this.tableName)
      .insert(items)
      .returning(returningFields);
  }

  async delete(
    knexTransaction: Knex.Transaction,
    params: Partial<PostgresGranuleDuplicate>
  ): Promise<number> {
    return await knexTransaction(this.tableName)
      .where(params)
      .del();
  }

  search(
    knexTransaction: Knex | Knex.Transaction,
    query: Partial<PostgresGranuleDuplicate>
  ) {
    return knexTransaction<PostgresGranuleDuplicate>(this.tableName)
      .where(query);
  }
  async count(
    knexOrTransaction: Knex | Knex.Transaction,
    params: ([string, string, string] | [Partial<PostgresGranuleDuplicate>])[]
  ) {
    const query = knexOrTransaction(this.tableName)
      .where((builder) => {
        params.forEach((param) => {
          if (param.length === 3) {
            builder.where(...param);
          }
          if (param.length === 1) {
            builder.where(param[0]);
          }
        });
      })
      .count();
    return await query;
  }
}

export { GranulesDuplicatesPgModel };

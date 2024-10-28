import { Knex } from 'knex';

import { isRecordDefined } from '../database';
import { TableNames } from '../tables';

import { PostgresGranuleExecution } from '../types/granule-execution';

export default class GranulesExecutionsPgModel {
  readonly tableName: TableNames;

  // can't extend base class because type for this data doesn't contain
  // a cumulus_id property
  constructor() {
    this.tableName = TableNames.granulesExecutions;
  }

  async create(
    knexTransaction: Knex | Knex.Transaction,
    item: PostgresGranuleExecution
  ) {
    return await knexTransaction(this.tableName).insert(item);
  }

  async exists(
    knexTransaction: Knex | Knex.Transaction,
    item: PostgresGranuleExecution
  ) {
    return isRecordDefined(await knexTransaction(this.tableName).where(item).first());
  }

  async upsert(
    knexTransaction: Knex | Knex.Transaction,
    item: PostgresGranuleExecution
  ) {
    return await knexTransaction(this.tableName)
      .insert(item)
      .onConflict(['granule_cumulus_id', 'execution_cumulus_id'])
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
    items: PostgresGranuleExecution[],
    returningFields: string | string[] = '*'
  ): Promise<PostgresGranuleExecution[]> {
    return await knexOrTransaction(this.tableName)
      .insert(items)
      .returning(returningFields);
  }
  /**
   * Get execution_cumulus_id column values from the granule_cumulus_id
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction -
   *  DB client or transaction
   * @param {number | Array<number>} granuleCumulusIds -
   * single granule_cumulus_id or array of granule_cumulus_ids
   * @returns {Promise<Array<number>>} An array of execution_cumulus_ids
   */
  async searchByGranuleCumulusIds(
    knexOrTransaction: Knex | Knex.Transaction,
    granuleCumulusIds: Array<number> | number
  ): Promise<Array<number>> {
    const granuleCumulusIdsArray = [granuleCumulusIds].flat();
    const granuleExecutions = await knexOrTransaction(this.tableName)
      .select('execution_cumulus_id')
      .whereIn('granule_cumulus_id', granuleCumulusIdsArray)
      .groupBy('execution_cumulus_id');
    return granuleExecutions.map((granuleExecution) => granuleExecution.execution_cumulus_id);
  }

  /**
   * Get granule_cumulus_id column values from the execution_cumulus_id
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction -
   *  DB client or transaction
   * @param {number | Array<number>} executionCumulusIds -
   * single execution_cumulus_id or array of execution_cumulus_ids
   * @returns {Promise<Array<number>>} An array of granule_cumulus_ids
   */
  async searchByExecutionCumulusIds(
    knexOrTransaction: Knex | Knex.Transaction,
    executionCumulusIds: Array<number> | number
  ): Promise<Array<number>> {
    const executionCumulusIdsArray = [executionCumulusIds].flat();
    const granuleExecutions: Array<PostgresGranuleExecution> =
      await knexOrTransaction(this.tableName)
        .select('granule_cumulus_id')
        .whereIn('execution_cumulus_id', executionCumulusIdsArray)
        .groupBy('granule_cumulus_id');
    return granuleExecutions.map((granuleExecution) => granuleExecution.granule_cumulus_id);
  }

  async delete(
    knexTransaction: Knex.Transaction,
    params: Partial<PostgresGranuleExecution>
  ): Promise<number> {
    return await knexTransaction(this.tableName)
      .where(params)
      .del();
  }

  search(
    knexTransaction: Knex | Knex.Transaction,
    query: Partial<PostgresGranuleExecution>
  ) {
    return knexTransaction<PostgresGranuleExecution>(this.tableName)
      .where(query);
  }
  async count(
    knexOrTransaction: Knex | Knex.Transaction,
    params: ([string, string, string] | [Partial<PostgresGranuleExecution>])[]
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

export { GranulesExecutionsPgModel };

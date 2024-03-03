import { Knex } from 'knex';

import { isRecordDefined } from '../database';
import { TableNames } from '../tables';

import { convertRecordsIdFieldsToNumber } from '../lib/typeHelpers';
import { PostgresGranuleExecution } from '../types/granule-execution';

export default class GranulesExecutionsPgModel {
  readonly tableName: TableNames;

  // can't extend base class because type for this data doesn't contain
  // a cumulus_id property
  constructor() {
    this.tableName = TableNames.granulesExecutions;
  }

  async create(
    knexTransaction: Knex.Transaction,
    item: PostgresGranuleExecution
  ) {
    return await knexTransaction(this.tableName).insert(item);
  }

  async exists(
    knexTransaction: Knex.Transaction,
    item: PostgresGranuleExecution
  ) {
    return isRecordDefined(await knexTransaction(this.tableName).where(item).first());
  }

  async upsert(
    knexTransaction: Knex.Transaction,
    item: PostgresGranuleExecution
  ) {
    const records = await knexTransaction(this.tableName)
      .insert(item)
      .onConflict(['granule_cumulus_id', 'execution_cumulus_id'])
      .merge()
      .returning('*');
    return convertRecordsIdFieldsToNumber(records);
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
    return granuleExecutions
      .map((granuleExecution) => Number(granuleExecution.execution_cumulus_id));
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
    return granuleExecutions.map((granuleExecution) => Number(granuleExecution.granule_cumulus_id));
  }

  async delete(
    knexTransaction: Knex.Transaction,
    params: Partial<PostgresGranuleExecution>
  ): Promise<number> {
    return await knexTransaction(this.tableName)
      .where(params)
      .del();
  }

  async search(
    knexTransaction: Knex | Knex.Transaction,
    query: Partial<PostgresGranuleExecution>
  ) {
    const records = await knexTransaction<PostgresGranuleExecution>(this.tableName)
      .where(query);
    return convertRecordsIdFieldsToNumber(records);
  }
}

export { GranulesExecutionsPgModel };

import { Knex } from 'knex';

import { BasePgModel } from './base';
import { TableNames } from '../tables';

import { PostgresExecution, PostgresExecutionRecord } from '../types/execution';
import { getSortFields } from '../lib/sort';
class ExecutionPgModel extends BasePgModel<PostgresExecution, PostgresExecutionRecord> {
  constructor() {
    super({
      tableName: TableNames.executions,
    });
  }

  static nonActiveStatuses = ['completed', 'failed', 'unknown'];

  create(
    knexOrTransaction: Knex | Knex.Transaction,
    item: PostgresExecution
  ) {
    return super.create(knexOrTransaction, item, '*');
  }

  async upsert(
    knexOrTrx: Knex | Knex.Transaction,
    execution: PostgresExecution,
    writeConstraints: boolean = true
  ) {
    const updatePayload =
      writeConstraints && execution.status === 'running'
        ? {
          created_at: execution.created_at,
          updated_at: execution.updated_at,
          timestamp: execution.timestamp,
          original_payload: execution.original_payload,
        }
        : execution;

    try {
      // Try to insert new execution (trigger enforces global uniqueness)
      return await knexOrTrx(this.tableName)
        .insert(execution)
        .returning('*');
    } catch (error) {
      // Trigger-raised duplicate, fallback to update
      // Attempt update (should affect at most 1 row due to global uniqueness invariant)
      if (error.code === '23505') {
        const updated = await await knexOrTrx(this.tableName)
          .where('arn', execution.arn)
          .limit(1) // defensive (not enforced by PG)
          .update(updatePayload)
          .returning('*');
        return updated; // may be []
      }
      throw error;
    }
  }

  /**
   * Get executions from the execution cumulus_id
   *
   * @param {Knex | Knex.Transaction} knexOrTrx -
   *  DB client or transaction
   * @param {Array<number>} executionCumulusIds -
   * single execution cumulus_id or array of execution cumulus_ids
   * @param {Object} [params] - Optional object with addition params for query
   * @param {number} [params.limit] - number of records to be returned
   * @param {number} [params.offset] - record offset
   * @returns An array of executions
   */
  async searchByCumulusIds(
    knexOrTrx: Knex | Knex.Transaction,
    executionCumulusIds: Array<number> | number,
    params: { limit: number, offset: number }
  ): Promise<Array<PostgresExecutionRecord>> {
    const { limit, offset, ...sortQueries } = params || {};
    const sortFields = getSortFields(sortQueries);
    const executionCumulusIdsArray = [executionCumulusIds].flat();
    const executions = await knexOrTrx(this.tableName)
      .whereIn('cumulus_id', executionCumulusIdsArray)
      .modify((queryBuilder) => {
        if (limit) queryBuilder.limit(limit);
        if (offset) queryBuilder.offset(offset);
        if (sortFields.length >= 1) {
          sortFields.forEach((sortObject: { [key: string]: { order: string } }) => {
            const sortField = Object.keys(sortObject)[0];
            const { order } = sortObject[sortField];
            queryBuilder.orderBy(sortField, order);
          });
        }
      });
    return executions;
  }
  /**
 * update executions to set archived=true within date range
 *
 * @param {Knex | Knex.Transaction} knexOrTrx -
 *  DB client or transaction
 * @param {Object} [params] - Optional object with addition params for query
 * @param {number} [params.limit] - number of records to be returned
 * @param {string} [params.expirationDate] - record offset
 * @returns {Promise<number>} number of records actually updated
 */
  async bulkArchive(
    knexOrTrx: Knex | Knex.Transaction,
    params: { limit: number; expirationDate: string }
  ): Promise<number> {
    const { limit, expirationDate } = params;
    const subQuery = knexOrTrx(this.tableName)
      .select('cumulus_id')
      .where('updated_at', '<', expirationDate)
      .where('archived', false)
      .limit(limit);
    return await knexOrTrx(this.tableName)
      .update({ archived: true })
      .whereIn('cumulus_id', subQuery);
  }
}

export { ExecutionPgModel };

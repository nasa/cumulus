import { Knex } from 'knex';

import Logger from '@cumulus/logger';

import { BasePgModel } from './base';
import { TableNames } from '../tables';

import { PostgresExecution, PostgresExecutionRecord } from '../types/execution';
import { getSortFields } from '../lib/sort';
import { RetryOnDbConnectionTerminateError } from '../lib/retry';
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
    if (writeConstraints && execution.status === 'running') {
      return await knexOrTrx(this.tableName)
        .insert(execution)
        .onConflict('arn')
        .merge({
          created_at: execution.created_at,
          updated_at: execution.updated_at,
          timestamp: execution.timestamp,
          original_payload: execution.original_payload,
        })
        .returning('*');
    }
    return await knexOrTrx(this.tableName)
      .insert(execution)
      .onConflict('arn')
      .merge()
      .returning('*');
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
   * @returns {Promise<Array<number>>} An array of executions
   */
  async searchByCumulusIds(
    knexOrTrx: Knex | Knex.Transaction,
    executionCumulusIds: Array<number> | number,
    params: { limit: number, offset: number }
  ): Promise<Array<number>> {
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
   * Fetches multiple items from Postgres that contain a payload before a date
   * this is included unused as a part of PR to ask, does this belong here?
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction - DB client or transaction
   * @param {Date} date
   * @param {numbers} limit
   * @returns {Promise<PostgresCollectionRecord[]>} List of returned records
   */
  async searchExecutionPayloadsBeforeDate(
    knexOrTransaction: Knex | Knex.Transaction,
    date: Date,
    limit: number = 10000
  ): Promise<PostgresExecutionRecord[]> {
    const log = new Logger({ sender: '@cumulus/db/models/execution' });
    const query: Promise<Array<PostgresExecutionRecord>> = knexOrTransaction(this.tableName)
      .where('updated_at', '<=', date)
      .where((builder) => {
        builder.whereNotNull('final_payload')
          .orWhereNotNull('original_payload');
      })
      .limit(limit);
    const records = await RetryOnDbConnectionTerminateError(query, {}, log);
    return records;
  }
}

export { ExecutionPgModel };

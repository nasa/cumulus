import Knex from 'knex';

import { BasePgModel } from './base';
import { tableNames } from '../tables';

import { PostgresExecution, PostgresExecutionRecord } from '../types/execution';

class ExecutionPgModel extends BasePgModel<PostgresExecution, PostgresExecutionRecord> {
  constructor() {
    super({
      tableName: tableNames.executions,
    });
  }

  async upsert(
    knexOrTrx: Knex | Knex.Transaction,
    execution: PostgresExecution
  ) {
    if (execution.status === 'running') {
      return await knexOrTrx(this.tableName)
        .insert(execution)
        .onConflict('arn')
        .merge({
          created_at: execution.created_at,
          updated_at: execution.updated_at,
          timestamp: execution.timestamp,
          original_payload: execution.original_payload,
        })
        .returning('cumulus_id');
    }
    return await knexOrTrx(this.tableName)
      .insert(execution)
      .onConflict('arn')
      .merge()
      .returning('cumulus_id');
  }

  async getWorkflowNamesFromExecutionCumulusIds(
    knexOrTrx: Knex | Knex.Transaction,
    executionCumulusIds: Array<string> | string
  ): Promise<Array<string>> {
    const executionCumulusIdsArray
      = (typeof executionCumulusIds === 'string') ? [executionCumulusIds] : executionCumulusIds;
    const executionWorkflowNames = await knexOrTrx(this.tableName)
      .select('workflow_name')
      .whereIn('cumulus_id', executionCumulusIdsArray);
    return executionWorkflowNames
      .map((executionWorkflowName) => executionWorkflowName.workflow_name);
  }
}

export { ExecutionPgModel };

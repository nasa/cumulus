import { Knex } from 'knex';
import { RecordDoesNotExist } from '@cumulus/errors';
import { ExecutionPgModel } from '../models/execution';
import { GranulesExecutionsPgModel } from '../models/granules-executions';
import { TableNames } from '../tables';

import { PostgresExecutionRecord } from '../types/execution';

const Logger = require('@cumulus/logger');

const { getKnexClient } = require('../connection');

export interface ArnRecord {
  arn: string;
}

const log = new Logger({ sender: '@cumulus/db/lib/execution' });

/**
 * Returns execution info sorted by most recent first for an input
 * set of Granule Cumulus IDs.
 * @returns Array of arn objects with the most recent first.
 */
export const getExecutionInfoByGranuleCumulusIds = async ({
  knexOrTransaction,
  granuleCumulusIds,
  limit,
}: {
  knexOrTransaction: Knex | Knex.Transaction,
  granuleCumulusIds: number[],
  limit?: number
}): Promise<{ granule_cumulus_id: number, url: string }[]> => {
  const knexQuery = knexOrTransaction(TableNames.executions)
    .column([
      `${TableNames.executions}.url`,
      `${TableNames.granulesExecutions}.granule_cumulus_id`,
    ])
    .whereIn(`${TableNames.granulesExecutions}.granule_cumulus_id`, granuleCumulusIds)
    .join(
      TableNames.granulesExecutions,
      `${TableNames.executions}.cumulus_id`,
      `${TableNames.granulesExecutions}.execution_cumulus_id`
    )
    .orderBy(`${TableNames.executions}.timestamp`, 'desc');
  if (limit) {
    knexQuery.limit(limit);
  }
  return await knexQuery;
};

/**
 * Returns execution info sorted by most recent first for an input
 * Granule Cumulus ID.
 *
 * @param {Object} params
 * @param {Knex | Knex.Transaction} params.knexOrTransaction
 *   Knex client for reading from RDS database
 * @param {Array<string>} params.executionColumns - Columns to return from executions table
 * @param {number} params.granuleCumulusId - The primary ID for a Granule
 * @param {number} [params.limit] - limit to number of executions to query
 * @returns {Promise<Partial<PostgresExecutionRecord>[]>}
 *   Array of arn objects with the most recent first.
 */
export const getExecutionInfoByGranuleCumulusId = async ({
  knexOrTransaction,
  granuleCumulusId,
  executionColumns = ['arn'],
  limit,
}: {
  knexOrTransaction: Knex | Knex.Transaction,
  granuleCumulusId: number,
  executionColumns: string[],
  limit?: number
}): Promise<Partial<PostgresExecutionRecord>[]> => {
  const knexQuery = knexOrTransaction(TableNames.executions)
    .column(executionColumns.map((column) => `${TableNames.executions}.${column}`))
    .where(`${TableNames.granulesExecutions}.granule_cumulus_id`, granuleCumulusId)
    .join(
      TableNames.granulesExecutions,
      `${TableNames.executions}.cumulus_id`,
      `${TableNames.granulesExecutions}.execution_cumulus_id`
    )
    .orderBy(`${TableNames.executions}.timestamp`, 'desc');
  if (limit) {
    knexQuery.limit(limit);
  }
  return await knexQuery;
};

/**
 * Returns a list of executionArns sorted by most recent first, for an input
 * list of granuleIds and workflowNames.
 *
 * @param {Knex} knex - DB Client
 * @param {string[]} granuleIds - Array of granuleIds
 * @param {string[]} workflowNames - Array of workflow names
 * @returns {Promise<ArnRecord[]>} - Array of arn objects with the most recent first.
 */
export const executionArnsFromGranuleIdsAndWorkflowNames = (
  knex: Knex,
  granuleIds: string[],
  workflowNames: string[]
): Promise<ArnRecord[]> =>
  knex
    .select(`${TableNames.executions}.arn`)
    .from(TableNames.executions)
    .join(
      TableNames.granulesExecutions,
      `${TableNames.executions}.cumulus_id`,
      `${TableNames.granulesExecutions}.execution_cumulus_id`
    )
    .join(
      TableNames.granules,
      `${TableNames.granules}.cumulus_id`,
      `${TableNames.granulesExecutions}.granule_cumulus_id`
    )
    .whereIn(`${TableNames.granules}.granule_id`, granuleIds)
    .whereIn(`${TableNames.executions}.workflow_name`, workflowNames)
    .orderBy(`${TableNames.executions}.timestamp`, 'desc');

/**
 * convenience function to return a single executionArn string for a intput
 *  granuleId and workflowName.
 *
 * @param {string} granuleId -  granuleIds
 * @param {string} workflowName - workflow name
 * @param {Knex} testKnex - knex for testing
 * @returns {Promise<string>} - most recent exectutionArn for input parameters.
 * @throws {RecordNotFound}
 */
export const newestExecutionArnFromGranuleIdWorkflowName = async (
  granuleId: string,
  workflowName: string,
  testKnex: Knex | undefined
): Promise<string> => {
  try {
    const knex = testKnex ?? await getKnexClient({ env: process.env });
    const executions = await executionArnsFromGranuleIdsAndWorkflowNames(
      knex,
      [granuleId],
      [workflowName]
    );
    if (executions.length === 0) {
      throw new RecordDoesNotExist(
        `No executionArns found for granuleId:${granuleId} running workflow:${workflowName}`
      );
    }
    return executions[0].arn;
  } catch (error) {
    log.error(error);
    throw error;
  }
};

/**
 * Returns the intersect of workflow names that exist for all granule ids that are passed in
 * When a single granule is passed in, workflow names are sorted by most recent first
 *
 * @param {Knex | Knex.Transaction} knexOrTransaction - DB Client or transaction
 * @param {Array<string>} granuleCumulusIds - Array of granule cumulus ids to query
 * @returns {Promise<string[]>} - Array consisting of workflow names common to all granules.
 * Sorted by most recent when array includes a single granule
 * @throws {RecordNotFound}
 */
export const getWorkflowNameIntersectFromGranuleIds = async (
  knexOrTransaction: Knex | Knex.Transaction,
  granuleCumulusIds: Array<number> | number
): Promise<Array<string>> => {
  const granuleCumulusIdsArray = [granuleCumulusIds].flat();
  const numberOfGranules = granuleCumulusIdsArray.length;
  const { executions: executionsTable, granulesExecutions: granulesExecutionsTable } = TableNames;

  const aggregatedWorkflowCounts: Array<{
    workflow_name: string,
    min: number
  }> = await knexOrTransaction(
    executionsTable
  )
    .select(['workflow_name'])
    .innerJoin(granulesExecutionsTable, `${executionsTable}.cumulus_id`, `${granulesExecutionsTable}.execution_cumulus_id`)
    .whereIn('granule_cumulus_id', granuleCumulusIdsArray)
    .groupBy('workflow_name')
    .countDistinct('granule_cumulus_id')
    .havingRaw('count(distinct granule_cumulus_id) = ?', [numberOfGranules])
    .modify((queryBuilder) => {
      if (numberOfGranules === 1) {
        queryBuilder.min('timestamp');
      }
    });

  /*
  sort (and group by) in knex causes an edge case where two distinct workflows
  of the same name will be returned if they have different timestamps. This means
  different returns depending on whether you have asked for one or multiple granules
  hence this sort has been moved to js logic
  */
  if (numberOfGranules === 1) {
    aggregatedWorkflowCounts.sort((a, b) => b.min - a.min);
  }
  return aggregatedWorkflowCounts.map(
    (workflowCounts: { workflow_name: string }) => workflowCounts.workflow_name
  );
};

/**
 * Get cumulus IDs for list of executions
 *
 * @param {Knex | Knex.Transaction} knexOrTransaction -
 *  DB client or transaction
 * @param {Array<Object>} executions - array of executions
 * @param {Object} [executionPgModel] - Execution PG model class instance
 * @returns {Promise<number[]>}
 */
export const getApiExecutionCumulusIds = async (
  knexOrTransaction: Knex | Knex.Transaction,
  executions: Array<{ arn: string }>,
  executionPgModel = new ExecutionPgModel()
) => {
  const executionCumulusIds: Array<number> = await Promise.all(executions.map(async (execution) =>
    await executionPgModel.getRecordCumulusId(knexOrTransaction, {
      arn: execution.arn,
    })));
  return [...new Set(executionCumulusIds)];
};

/**
 * Get cumulus IDs for all granules associated to a set of executions
 *
 * @param {Knex | Knex.Transaction} knexOrTransaction -
 *  DB client or transaction
 * @param {Array<Object>} executions - array of executions
 * @param {Object} [executionsPgModel]
 *   Executions PG model class instance
 * @returns {Promise<number[]>}
 */
export const getApiGranuleExecutionCumulusIdsByExecution = async (
  knexOrTransaction: Knex | Knex.Transaction,
  executions: Array<{ arn: string }>,
  executionPgModel = new ExecutionPgModel(),
  granulesExecutionsPgModel = new GranulesExecutionsPgModel()
): Promise<Array<number>> => {
  const executionCumulusIds = await getApiExecutionCumulusIds(
    knexOrTransaction, executions, executionPgModel
  );
  const granuleCumulusIds = await granulesExecutionsPgModel
    .searchByExecutionCumulusIds(knexOrTransaction, executionCumulusIds);

  return granuleCumulusIds;
};

export const batchDeleteExecutionFromDatabaseByCumulusCollectionId = async (
  params: {
    knex: Knex | Knex.Transaction,
    collectionCumulusId: number,
    batchSize: number,
  }
) => {
  const { knex, collectionCumulusId, batchSize = 1 } = params;
  try {
    return await knex('executions')
      .whereIn('cumulus_id',
        knex.select('cumulus_id')
          .from('executions')
          .where('collection_cumulus_id', collectionCumulusId)
          .limit(batchSize))
      .delete();
  } catch (error) {
    throw new Error(`Failed to delete from database: ${error.message}`);
  }
};

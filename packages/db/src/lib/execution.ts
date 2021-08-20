import Knex from 'knex';
import { RecordDoesNotExist } from '@cumulus/errors';
import { tableNames } from '../tables';

const Logger = require('@cumulus/logger');

const { getKnexClient } = require('../connection');

export interface arnRecord {
  arn: string;
}

const log = new Logger({ sender: '@cumulus/db/lib/execution' });

/**
 * Returns a list of executionArns sorted by most recent first, for an input
 * Granule Cumulus ID.
 *
 * @param {Knex | Knex.Transaction} knexOrTransaction
 *   Knex client for reading from RDS database
 * @param {number} granuleCumulusId - The primary ID for a Granule
 * @returns {Promise<arnRecord[]>} - Array of arn objects with the most recent first.
 */
export const getExecutionArnsByGranuleCumulusId = (
  knexOrTransaction: Knex | Knex.Transaction,
  granuleCumulusId: Number
): Promise<arnRecord[]> =>
  knexOrTransaction(tableNames.executions)
    .select(`${tableNames.executions}.arn`)
    .where(`${tableNames.granules}.cumulus_id`, granuleCumulusId)
    .join(
      tableNames.granulesExecutions,
      `${tableNames.executions}.cumulus_id`,
      `${tableNames.granulesExecutions}.execution_cumulus_id`
    )
    .join(
      tableNames.granules,
      `${tableNames.granules}.cumulus_id`,
      `${tableNames.granulesExecutions}.granule_cumulus_id`
    )
    .orderBy(`${tableNames.executions}.timestamp`, 'desc');

/**
 * Returns a list of executionArns sorted by most recent first, for an input
 * list of granuleIds and workflowNames.
 *
 * @param {Knex} knex - DB Client
 * @param {string[]} granuleIds - Array of granuleIds
 * @param {string[]} workflowNames - Array of workflow names
 * @returns {Promise<arnRecord[]>} - Array of arn objects with the most recent first.
 */
export const executionArnsFromGranuleIdsAndWorkflowNames = (
  knex: Knex,
  granuleIds: string[],
  workflowNames: string[]
): Promise<arnRecord[]> =>
  knex
    .select(`${tableNames.executions}.arn`)
    .from(tableNames.executions)
    .join(
      tableNames.granulesExecutions,
      `${tableNames.executions}.cumulus_id`,
      `${tableNames.granulesExecutions}.execution_cumulus_id`
    )
    .join(
      tableNames.granules,
      `${tableNames.granules}.cumulus_id`,
      `${tableNames.granulesExecutions}.granule_cumulus_id`
    )
    .whereIn(`${tableNames.granules}.granule_id`, granuleIds)
    .whereIn(`${tableNames.executions}.workflow_name`, workflowNames)
    .orderBy(`${tableNames.executions}.timestamp`, 'desc');

/**
 * convenience function to return a single executionArn string for a intput
 *  granuleId and workflowName.
 *
 * @param {string} granuleId -  granuleIds
 * @param {string} workflowName - workflow name
 * @param {Knex} testKnex - DB Client
 * @returns {Promise<string>} - most recent exectutionArn for input parameters.
 * @throws {RecordNotFound}
 */
export const newestExecutionArnFromGranuleIdWorkflowName = async (
  granuleId: string,
  workflowName: string,
  testKnex: Knex|undefined
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
  const { executions: executionsTable, granulesExecutions: granulesExecutionsTable } = tableNames;

  const aggregatedWorkflowCounts = await knexOrTransaction(executionsTable)
    .select('workflow_name')
    .countDistinct('granule_cumulus_id')
    .innerJoin(granulesExecutionsTable, `${executionsTable}.cumulus_id`, `${granulesExecutionsTable}.execution_cumulus_id`)
    .whereIn('granule_cumulus_id', granuleCumulusIdsArray)
    .groupBy('workflow_name')
    .havingRaw('count(distinct granule_cumulus_id) = ?', [numberOfGranules])
    .modify((queryBuilder) => {
      if (numberOfGranules === 1) {
        queryBuilder.groupBy('timestamp')
          .orderBy('timestamp', 'desc');
      }
    });
  return aggregatedWorkflowCounts
    .map((workflowCounts: { workflow_name: string }) => workflowCounts.workflow_name);
};

import Knex from 'knex';

import { tableNames } from '../tables';

export interface arnRecord {
  arn: string;
}

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
): Promise<arnRecord[]> => knex
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

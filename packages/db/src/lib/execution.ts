import Knex from 'knex';

const Logger = require('@cumulus/logger');

const { getKnexClient } = require('../connection');
import { tableNames } from '../tables';
import { RecordDoesNotExist } from '@cumulus/errors';

export interface arnRecord {
  arn: string;
}

const log = new Logger({ sender: '@cumulus/db/lib/execution' });

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
 * @returns {Promise<string>} - most recent exectutionArn for input parameters.
 * @throws {RecordNotFound}
 */
export const newestExecutionArnFromGranuleIdWorkflowName = async (
    granuleId: string,
    workflowName: string,
    testKnex: Knex|undefined,
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

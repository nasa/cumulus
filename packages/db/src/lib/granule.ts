import Knex from 'knex';

import { PostgresGranule } from '../types/granule';
import { GranulePgModel } from '../models/granule';
import { GranulesExecutionsPgModel } from '../models/granules-executions';

/**
 * Upsert a granule and a record in the granules/executions join table.
 *
 * @param {Knex.Transaction} knexTransaction - A Knex client transaction
 * @param {PostgresGranule} granule - Granule data
 * @param {number} [executionCumulusId] - Execution record cumulus_id value
 * @param {Object} [granulePgModel] - Granule PG model class instance
 * @param {Object} [granulesExecutionsPgModel]
 *   Granules/executions PG model class instance
 * @returns {Promise<number[]>}
 */
export const upsertGranuleWithExecutionJoinRecord = async (
  knexTransaction: Knex.Transaction,
  granule: PostgresGranule,
  executionCumulusId?: number,
  granulePgModel = new GranulePgModel(),
  granulesExecutionsPgModel = new GranulesExecutionsPgModel()
): Promise<number[]> => {
  const [granuleCumulusId] = await granulePgModel.upsert(
    knexTransaction,
    granule,
    executionCumulusId
  );
  // granuleCumulusId could be undefined if the upsert affected no rows due to its
  // conditional logic. In that case, we assume that the execution history for the
  // granule was already written and return early. Execution history cannot be written
  // without granuleCumulusId regardless.
  if (!granuleCumulusId) {
    return [];
  }
  if (executionCumulusId) {
    await granulesExecutionsPgModel.upsert(
      knexTransaction,
      {
        granule_cumulus_id: granuleCumulusId,
        execution_cumulus_id: executionCumulusId,
      }
    );
  }
  return [granuleCumulusId];
};

/**
 * Get cumulus IDs for all executions associated to a set of granules
 *
 * @param {Knex | Knex.Transaction} knexOrTransaction -
 *  DB client or transaction
 * @param {Array<string>} columnNames - column names for whereIn query
 * @param {Knex.QueryCallback} values - record values for whereIn query
 * @param {Object} [granulePgModel] - Granule PG model class instance
 * @param {Object} [granulesExecutionsPgModel]
 *   Granules/executions PG model class instance
 * @returns {Promise<number[]>}
 */
export const getGranuleExecutionCumulusIds = async (
  knexOrTransaction: Knex | Knex.Transaction,
  columnNames: Array<string>,
  values: Knex.QueryCallback,
  granulePgModel = new GranulePgModel(),
  granulesExecutionsPgModel = new GranulesExecutionsPgModel()
): Promise<Array<number>> => {
  const granuleCumulusIds: Array<number> = await granulePgModel
    .getRecordsCumulusIds(knexOrTransaction, columnNames, values);

  const executionCumulusIds = await granulesExecutionsPgModel
    .getExecutionCumulusIdsFromGranuleCumulusIds(knexOrTransaction, granuleCumulusIds);

  return executionCumulusIds;
};

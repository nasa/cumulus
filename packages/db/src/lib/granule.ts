import Knex from 'knex';

import { PostgresGranule } from '../types/granule';

import { GranulePgModel } from '../models/granule';
import { GranulesExecutionsPgModel } from '../models/granules-executions';

/**
 * Create a granule and a record in the granules/executions join table.
 *
 * @param {Knex.Transaction} knexTransaction - A Knex client transaction
 * @param {PostgresGranule} granule - Granule data
 * @param {number} executionCumulusId - Execution record cumulus_id value
 * @param {Object} [granulePgModel] - Granule PG model class instance
 * @param {Object} [granulesExecutionsPgModel]
 *   Granules/executions PG model class instance
 * @returns {Promise}
 */
export const createGranuleWithExecutionHistory = async (
  knexTransaction: Knex.Transaction,
  granule: PostgresGranule,
  executionCumulusId: number,
  granulePgModel = new GranulePgModel(),
  granulesExecutionsPgModel = new GranulesExecutionsPgModel()
): Promise<number[]> => {
  const [granuleCumulusId] = await granulePgModel.create(
    knexTransaction,
    granule
  );
  await granulesExecutionsPgModel.create(
    knexTransaction,
    {
      granule_cumulus_id: granuleCumulusId,
      execution_cumulus_id: executionCumulusId,
    }
  );
  return [granuleCumulusId];
};

/**
 * Delete a granule and its records in the granules/executions join table.
 *
 * This method only invokes `granulePgModel.delete()` because the foreign key
 * column in the executions table that references the granule is defined with
 * ON CASCADE DELETE. So deleting the record from the granule record automatically
 * deletes the records in the granules/executions join table.
 *
 * @param {Knex.Transaction} knexTransaction - A Knex client transaction
 * @param {PostgresGranule} granule - Granule data
 * @param {Object} [granulePgModel] - Granule PG model class instance
 * @returns {Promise}
 */
export const deleteGranuleWithExecutionHistory = async (
  knexTransaction: Knex.Transaction,
  granule: PostgresGranule,
  granulePgModel = new GranulePgModel()
) => granulePgModel.delete(
  knexTransaction,
  granule
);

/**
 * Upsert a granule and a record in the granules/executions join table.
 *
 * @param {Knex.Transaction} knexTransaction - A Knex client transaction
 * @param {PostgresGranule} granule - Granule data
 * @param {number} executionCumulusId - Execution record cumulus_id value
 * @param {Object} [granulePgModel] - Granule PG model class instance
 * @param {Object} [granulesExecutionsPgModel]
 *   Granules/executions PG model class instance
 * @returns {Promise<number[]>}
 */
export const upsertGranuleWithExecutionHistory = async (
  knexTransaction: Knex.Transaction,
  granule: PostgresGranule,
  executionCumulusId: number,
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
  await granulesExecutionsPgModel.upsert(
    knexTransaction,
    {
      granule_cumulus_id: granuleCumulusId,
      execution_cumulus_id: executionCumulusId,
    }
  );
  return [granuleCumulusId];
};

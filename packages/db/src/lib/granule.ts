import Knex from 'knex';

import { PostgresGranule } from '../types/granule';

import { GranulePgModel } from '../models/granule';
import { GranulesExecutionsPgModel } from '../models/granules-executions';

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

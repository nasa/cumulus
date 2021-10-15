import { Knex } from 'knex';

import { RecordDoesNotExist } from '@cumulus/errors';
import Logger from '@cumulus/logger';

import { PostgresGranule, PostgresGranuleRecord } from '../types/granule';
import { CollectionPgModel } from '../models/collection';
import { GranulePgModel } from '../models/granule';
import { GranulesExecutionsPgModel } from '../models/granules-executions';

const { constructCollectionId, deconstructCollectionId } = require('@cumulus/message/Collections');

export const getGranuleCollectionId = async (
  knexOrTransaction: Knex | Knex.Transaction,
  granule: PostgresGranule
) => {
  const collectionPgModel = new CollectionPgModel();
  const collection = await collectionPgModel.get(
    knexOrTransaction, { cumulus_id: granule.collection_cumulus_id }
  );
  return constructCollectionId(collection.name, collection.version);
};

/**
 * Upsert a granule and a record in the granules/executions join table.
 *
 * @param {Knex.Transaction} knexTransaction - A Knex client transaction
 * @param {PostgresGranule} granule - Granule data
 * @param {number} [executionCumulusId] - Execution record cumulus_id value
 * @param {Object} [granulePgModel] - Granule PG model class instance
 * @param {Object} [granulesExecutionsPgModel]
 *   Granules/executions PG model class instance
 * @returns {Promise<PostgresGranuleRecord[]>}
 */
export const upsertGranuleWithExecutionJoinRecord = async (
  knexTransaction: Knex.Transaction,
  granule: PostgresGranule,
  executionCumulusId?: number,
  granulePgModel = new GranulePgModel(),
  granulesExecutionsPgModel = new GranulesExecutionsPgModel()
): Promise<PostgresGranuleRecord[]> => {
  const [pgGranule] = await granulePgModel.upsert(
    knexTransaction,
    granule,
    executionCumulusId
  );
  // granuleCumulusId could be undefined if the upsert affected no rows due to its
  // conditional logic. In that case, we assume that the execution history for the
  // granule was already written and return early. Execution history cannot be written
  // without granuleCumulusId regardless.
  if (!pgGranule) {
    return [];
  }
  if (executionCumulusId) {
    await granulesExecutionsPgModel.upsert(
      knexTransaction,
      {
        granule_cumulus_id: pgGranule.cumulus_id,
        execution_cumulus_id: executionCumulusId,
      }
    );
  }
  return [pgGranule];
};

/**
 * Get cumulus IDs for list of granules
 *
 * @param {Knex | Knex.Transaction} knexOrTransaction -
 *  DB client or transaction
 * @param {Array<Object>} granules - array of granules with collectionId and granuleId
 * @param {Object} [collectionPgModel] - Collection PG model class instance
 * @param {Object} [granulePgModel] - Granule PG model class instance
 * @returns {Promise<number[]>}
 */
export const getApiGranuleCumulusIds = async (
  knexOrTransaction: Knex | Knex.Transaction,
  granules: Array<{ collectionId: string, granuleId: string }>,
  collectionPgModel = new CollectionPgModel(),
  granulePgModel = new GranulePgModel()
) => {
  const collectionMap: { [key: string]: number } = {};

  const granuleCumulusIds: Array<number> = await Promise.all(granules.map(async (granule) => {
    const { collectionId } = granule;
    let collectionCumulusId = collectionMap[collectionId];

    if (!collectionCumulusId) {
      const { name, version } = deconstructCollectionId(collectionId);
      collectionCumulusId = await collectionPgModel.getRecordCumulusId(
        knexOrTransaction,
        { name, version }
      );
      collectionMap[collectionId] = collectionCumulusId;
    }

    return await granulePgModel.getRecordCumulusId(knexOrTransaction, {
      granule_id: granule.granuleId,
      collection_cumulus_id: collectionCumulusId,
    });
  }));
  return [...new Set(granuleCumulusIds)];
};

/**
 * Get one Granule for a granule_id. If more than one or none are found, throw an error
 *
 * @param {Knex | Knex.Transaction} knexOrTransaction -
 *  DB client or transaction
 * @param {string} granuleId - a Granule ID
 * @param {GranulePgModel} granulePgModel - Granule PG model class instance
 * @returns {Promise<PostgresGranuleRecord>}
 */
export const getUniqueGranuleByGranuleId = async (
  knexOrTransaction: Knex | Knex.Transaction,
  granuleId: string,
  granulePgModel = new GranulePgModel()
): Promise<PostgresGranuleRecord> => {
  const logger = new Logger({ sender: '@cumulus/api/granules' });

  const PgGranuleRecords = await granulePgModel.search(knexOrTransaction, {
    granule_id: granuleId,
  });
  if (PgGranuleRecords.length > 1) {
    logger.warn(`Granule ID ${granuleId} is not unique across collections, cannot make an update action based on granule Id alone`);
    throw new Error(`Failed to write ${granuleId} due to granuleId duplication on postgres granule record`);
  }
  if (PgGranuleRecords.length === 0) {
    throw new RecordDoesNotExist(`Granule ${granuleId} does not exist or was already deleted`);
  }

  return PgGranuleRecords[0];
};

/**
 * Get cumulus IDs for all executions associated to a set of granules
 *
 * @param {Knex | Knex.Transaction} knexOrTransaction -
 *  DB client or transaction
 * @param {Array<Object>} granules - array of granules with collectionId and granuleId
 * @param {Object} [collectionPgModel] - Collection PG model class instance
 * @param {Object} [granulePgModel] - Granule PG model class instance
 * @param {Object} [granulesExecutionsPgModel]
 *   Granules/executions PG model class instance
 * @returns {Promise<number[]>}
 */
export const getApiGranuleExecutionCumulusIds = async (
  knexOrTransaction: Knex | Knex.Transaction,
  granules: Array<{ collectionId: string, granuleId: string }>,
  collectionPgModel = new CollectionPgModel(),
  granulePgModel = new GranulePgModel(),
  granulesExecutionsPgModel = new GranulesExecutionsPgModel()
): Promise<Array<number>> => {
  const granuleCumulusIds = await getApiGranuleCumulusIds(
    knexOrTransaction, granules, collectionPgModel, granulePgModel
  );
  const executionCumulusIds = await granulesExecutionsPgModel
    .searchByGranuleCumulusIds(knexOrTransaction, granuleCumulusIds);

  return executionCumulusIds;
};

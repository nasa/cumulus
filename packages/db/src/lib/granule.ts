import { Knex } from 'knex';

import {
  collectionIdSeparator,
  constructCollectionId,
  deconstructCollectionId,
} from '@cumulus/message/Collections';

import { RecordDoesNotExist } from '@cumulus/errors';
import Logger from '@cumulus/logger';

import { CollectionPgModel } from '../models/collection';
import { GranulePgModel } from '../models/granule';
import { GranulesExecutionsPgModel } from '../models/granules-executions';
import { PostgresGranule, PostgresGranuleRecord } from '../types/granule';
import { GranuleWithProviderAndCollectionInfo } from '../types/query';
import { UpdatedAtRange } from '../types/record';

const { TableNames } = require('../tables');

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

/**
 * Helper to build a query to search granules by various API granule record properties.
 *
 * @param {Knex} knex - DB client
 * @param {Object} searchParams
 * @param {string | Array<string>} [searchParams.collectionIds] - Collection ID
 * @param {string | Array<string>} [searchParams.granuleIds] - array of granule IDs
 * @param {string} [searchParams.providerName] - Provider name
 * @param {UpdatedAtRange} [searchParams.updatedAtRange] - Date range for updated_at column
 * @param {string} [searchParams.status] - Granule status to search by
 * @param {string | Array<string>} [sortByFields] - Field(s) to sort by
 * @returns {Knex.QueryBuilder}
 */
export const getGranulesByApiPropertiesQuery = (
  knex: Knex,
  {
    collectionIds,
    granuleIds,
    providerNames,
    updatedAtRange = {},
    status,
  }: {
    collectionIds?: string | string[],
    granuleIds?: string | string[],
    providerNames?: string[],
    updatedAtRange?: UpdatedAtRange,
    status?: string,
  },
  sortByFields?: string | string[]
): Knex.QueryBuilder => {
  const {
    granules: granulesTable,
    collections: collectionsTable,
    providers: providersTable,
  } = TableNames;
  return knex<GranuleWithProviderAndCollectionInfo>(granulesTable)
    .select(`${granulesTable}.*`)
    .select({
      providerName: `${providersTable}.name`,
      collectionName: `${collectionsTable}.name`,
      collectionVersion: `${collectionsTable}.version`,
    })
    .innerJoin(collectionsTable, `${granulesTable}.collection_cumulus_id`, `${collectionsTable}.cumulus_id`)
    .leftJoin(providersTable, `${granulesTable}.provider_cumulus_id`, `${providersTable}.cumulus_id`)
    .modify((queryBuilder) => {
      if (collectionIds) {
        const collectionIdFilters = [collectionIds].flat();
        const collectionIdConcatField = `(${collectionsTable}.name || '${collectionIdSeparator}' || ${collectionsTable}.version)`;
        const collectionIdInClause = collectionIdFilters.map(() => '?').join(',');
        queryBuilder.whereRaw(
          `${collectionIdConcatField} IN (${collectionIdInClause})`,
          collectionIdFilters
        );
      }
      if (granuleIds) {
        const granuleIdFilters = [granuleIds].flat();
        queryBuilder.where((nestedQueryBuilder) => {
          granuleIdFilters.forEach((granuleId) => {
            nestedQueryBuilder.orWhere(`${granulesTable}.granule_id`, 'LIKE', `%${granuleId}%`);
          });
        });
      }
      if (providerNames) {
        queryBuilder.whereIn(`${providersTable}.name`, providerNames);
      }
      if (updatedAtRange.updatedAtFrom) {
        queryBuilder.where(`${granulesTable}.updated_at`, '>=', updatedAtRange.updatedAtFrom);
      }
      if (updatedAtRange.updatedAtTo) {
        queryBuilder.where(`${granulesTable}.updated_at`, '<=', updatedAtRange.updatedAtTo);
      }
      if (status) {
        queryBuilder.where(`${granulesTable}.status`, status);
      }
      if (sortByFields) {
        queryBuilder.orderBy([sortByFields].flat());
      }
    })
    .groupBy(`${granulesTable}.cumulus_id`)
    .groupBy(`${collectionsTable}.cumulus_id`)
    .groupBy(`${providersTable}.cumulus_id`);
};

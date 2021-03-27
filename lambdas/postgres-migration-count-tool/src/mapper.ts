import { getExecutions } from '@cumulus/api-client/executions';
import { listGranules } from '@cumulus/api-client/granules';
import { getPdrs } from '@cumulus/api-client/pdrs';

import {
  GranulePgModel,
  PdrPgModel,
  ExecutionPgModel,
  Knex,
} from '@cumulus/db';

import { getEsCutoffQuery, getDbCount, getPostgresModelCount } from './utils';
import { StatsObject, CollectionMapping } from './types';

const postgresGranuleModel = new GranulePgModel();
const postgresExecutionModel = new ExecutionPgModel();
const postgresPdrModel = new PdrPgModel();

/**
* pMap mapping function that returns a StatsObject from a collection map
* @summary Generates a StatsObject containing postgres (from a database query
* and Dynamo counts (from a call to the internal API)
* @param {Object} params - method parameters
* @param {string} params.cutoffIsoString -
* @param {number} params.cutoffTime - Epoch time to query before to avoid
* 'leading edge'/post-phase 1 migration discrepancies
* @param {Knex} params.knexClient - Knex client
* @param {string} params.prefix - Stack prefix
* @param {CollectionMapping} params.collectionMap - CollectionMapping object with
* collection IDs to query against
* @param {Function} params.getPdrsFunction - Optional overrides for test/mocks
* @param {Function} params.listGranulesFunction - Optional overrides for test/mocks
* @param {Function} params.getExecutionsFunction - Optional overrides for test/mocks
* @param {Function} params.countPostgresRecordsFunction - Optional overrides for test/mocks
* @returns {ReturnValueDataTypeHere} Brief description of the returning value here.
*/
export const mapper = async (params: {
  cutoffIsoString: string,
  cutoffTime: number,
  knexClient: Knex,
  prefix: string,
  getPdrsFunction?: typeof getPdrs,
  listGranulesFunction?: typeof listGranules,
  getExecutionsFunction?: typeof getExecutions,
  getPostgresPdrModelCountFunction?: typeof getPostgresModelCount,
  getPostgresGranuleModelCountFunction?: typeof getPostgresModelCount,
  getPostgresExecutionModelCountFunction?: typeof getPostgresModelCount
  collectionMap: CollectionMapping,
}): Promise<StatsObject> => {
  const {
    collectionMap,
    cutoffIsoString,
    cutoffTime,
    knexClient,
    prefix,
    getPdrsFunction = getPdrs,
    listGranulesFunction = listGranules,
    getExecutionsFunction = getExecutions,
    getPostgresPdrModelCountFunction = getPostgresModelCount,
    getPostgresGranuleModelCountFunction = getPostgresModelCount,
    getPostgresExecutionModelCountFunction = getPostgresModelCount,
  } = { ...params };
  const { collection, postgresCollectionId } = collectionMap;
  const collectionId = `${collection.name}___${collection.version}`;
  return {
    collectionId,
    counts: await Promise.all([
      getDbCount(
        getPdrsFunction({
          prefix,
          query: getEsCutoffQuery(
            ['pdrName', 'createdAt'],
            cutoffTime,
            collectionId
          ),
        })
      ),
      getDbCount(
        listGranulesFunction({
          prefix,
          query: getEsCutoffQuery(
            ['granuleId', 'createdAt'],
            cutoffTime,
            collectionId
          ),
        })
      ),
      getDbCount(
        getExecutionsFunction({
          prefix,
          query: getEsCutoffQuery(
            ['execution', 'createdAt'],
            cutoffTime,
            collectionId
          ),
        })
      ),
      getPostgresPdrModelCountFunction({
        model: postgresPdrModel,
        knexClient,
        cutoffIsoString,
        queryParams: [[{ collection_cumulus_id: postgresCollectionId }]],
      }),
      getPostgresGranuleModelCountFunction({
        model: postgresGranuleModel,
        knexClient,
        cutoffIsoString,
        queryParams: [[{ collection_cumulus_id: postgresCollectionId }]],
      }),
      getPostgresExecutionModelCountFunction({
        model: postgresExecutionModel,
        knexClient,
        cutoffIsoString,
        queryParams: [[{ collection_cumulus_id: postgresCollectionId }]],
      }),
    ]),
  };
};

/**
* pMap mapping function that returns a StatsObject from a collection map
* @summary Generates a StatsObject containing postgres (from a database query
* and Dynamo counts (from a call to the internal API)
* @param {string} cutoffIsoString - Cutoff time in ISO format
* @param {number} cutoffTime - Epoch time to query before to a
* avoid 'leading edge'/post-phase 1 migration discrepancies
* @param {Knex} knexClient - Knex client
* @param {string} prefix - Stack prefix
* @param {CollectionMapping} collectionMap - CollectionMapping object
* with collection IDs to query against
* @returns {Promise<StatsObject>} Stats object returned from mapper
*/
export const pMapMapper = async (
  cutoffIsoString: string,
  cutoffTime: number,
  knexClient: Knex,
  prefix: string,
  collectionMap: CollectionMapping
): Promise<StatsObject> => {
  const returnVal = await mapper({
    cutoffIsoString,
    cutoffTime,
    knexClient,
    prefix,
    collectionMap,
  });
  return returnVal;
};

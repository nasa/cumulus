import { constructCollectionId } from '@cumulus/message/Collections';
import { getExecutions } from '@cumulus/api-client/executions';
import { getPdrs } from '@cumulus/api-client/pdrs';
import { listGranules } from '@cumulus/api-client/granules';

import {
  GranulePgModel,
  PdrPgModel,
  ExecutionPgModel,
  Knex,
} from '@cumulus/db';

import { getEsCutoffQuery, getDbCount, countPostgresRecords } from './utils';
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
  countPostgresPdrModelRecordsFunction?: typeof countPostgresRecords,
  countPostgresGranuleModelRecordsFunction?: typeof countPostgresRecords,
  countPostgresExecutionModelRecords?: typeof countPostgresRecords
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
    countPostgresPdrModelRecordsFunction = countPostgresRecords,
    countPostgresGranuleModelRecordsFunction = countPostgresRecords,
    countPostgresExecutionModelRecords = countPostgresRecords,
  } = { ...params };
  const { collection, postgresCollectionId } = collectionMap;
  const collectionId = constructCollectionId(collection.name, collection.version);
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
      countPostgresPdrModelRecordsFunction({
        model: postgresPdrModel,
        knexClient,
        cutoffIsoString,
        queryParams: [[{ collection_cumulus_id: postgresCollectionId }]],
      }),
      countPostgresGranuleModelRecordsFunction({
        model: postgresGranuleModel,
        knexClient,
        cutoffIsoString,
        queryParams: [[{ collection_cumulus_id: postgresCollectionId }]],
      }),
      countPostgresExecutionModelRecords({
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

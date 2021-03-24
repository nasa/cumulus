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

export const mapper = async (
  cutoffIsoString: string,
  cutoffTime: number,
  knexClient: Knex,
  prefix: string,
  collectionMap: CollectionMapping,
  testParams?: {
    getPdrsFunction?: typeof getPdrs,
    listGranulesFunction?: typeof listGranules,
    getExecutionsFunction?: typeof getExecutions,
    getPostgresModelCountFunction?: typeof getPostgresModelCount
  },
): Promise<StatsObject> => {
  const {
    getPdrsFunction = getPdrs,
    listGranulesFunction = listGranules,
    getExecutionsFunction = getExecutions,
    getPostgresModelCountFunction = getPostgresModelCount,
  } = {...testParams };
  const { collection, postgresCollectionId } = collectionMap;
  const collectionId = `${collection.name}__${collection.version}`;
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
      getPostgresModelCountFunction({
        model: postgresGranuleModel,
        knexClient,
        cutoffIsoString,
        queryParams: [[{ collection_cumulus_id: postgresCollectionId }]],
      }),
      getPostgresModelCountFunction({
        model: postgresPdrModel,
        knexClient,
        cutoffIsoString,
        queryParams: [[{ collection_cumulus_id: postgresCollectionId }]],
      }),
      getPostgresModelCountFunction({
        model: postgresExecutionModel,
        knexClient,
        cutoffIsoString,
        queryParams: [[{ collection_cumulus_id: postgresCollectionId }]],
      }),
    ]),
  };
};

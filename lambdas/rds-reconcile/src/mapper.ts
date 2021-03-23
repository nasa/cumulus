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
): Promise<StatsObject> => {
  const { collection, postgresCollectionId } = collectionMap;
  const collectionId = `${collection.name}___${collection.version}`;
  return {
    collectionId,
    counts: await Promise.all([
      getDbCount(
        getPdrs({
          prefix,
          query: getEsCutoffQuery(
            ['pdrName', 'createdAt'],
            cutoffTime,
            collectionId
          ),
        })
      ),
      getDbCount(
        listGranules({
          prefix,
          query: getEsCutoffQuery(
            ['granuleId', 'createdAt'],
            cutoffTime,
            collectionId
          ),
        })
      ),
      getDbCount(
        getExecutions({
          prefix,
          query: getEsCutoffQuery(
            ['execution', 'createdAt'],
            cutoffTime,
            collectionId
          ),
        })
      ),
      getPostgresModelCount({
        model: postgresGranuleModel,
        knexClient,
        cutoffIsoString,
        queryParams: [[{ collection_cumulus_id: postgresCollectionId }]],
      }),
      getPostgresModelCount({
        model: postgresPdrModel,
        knexClient,
        cutoffIsoString,
        queryParams: [[{ collection_cumulus_id: postgresCollectionId }]],
      }),
      getPostgresModelCount({
        model: postgresExecutionModel,
        knexClient,
        cutoffIsoString,
        queryParams: [[{ collection_cumulus_id: postgresCollectionId }]],
      }),
    ]),
  };
};

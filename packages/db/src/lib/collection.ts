import { Knex } from 'knex';
import pRetry from 'p-retry';

import Logger from '@cumulus/logger';

import { TableNames } from '../tables';

/**
 * Get collection results for a given set of granule IDs
 *
 * @param {Knex} knex - Knex databse client
 * @param {Array<string>} granuleIds - Array of granule IDs
 * @returns {Promise<Array<Object>>} - An array of collection results
 */
export const getCollectionsByGranuleIds = async (
  knex: Knex,
  granuleIds: string[]
) => {
  const {
    collections: collectionsTable,
    granules: granulesTable,
  } = TableNames;
  const log = new Logger({ sender: '@cumulus/db/models/collection' });
  const query = knex(collectionsTable)
    .select(`${collectionsTable}.*`)
    .innerJoin(granulesTable, `${collectionsTable}.cumulus_id`, `${granulesTable}.collection_cumulus_id`)
    .whereIn(`${granulesTable}.granule_id`, granuleIds)
    .groupBy(`${collectionsTable}.cumulus_id`);
  return await pRetry(
    async () => {
      try {
        return await query;
      } catch (error) {
        if (error.message.includes('Connection terminated unexpectedly')) {
          log.error(`Error caught in getCollectionsByGranuleIds. ${error}. Retrying...`);
          throw error;
        }
        log.error(`Error caught in getCollectionsByGranuleIds. ${error}`);
        throw new pRetry.AbortError(error);
      }
    },
    {
      retries: 3,
      onFailedAttempt: (e) => {
        log.error(`Error ${e.message}. Attempt ${e.attemptNumber} failed.`);
      },
    }
  );
};

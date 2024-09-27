import { Knex } from 'knex';
import Logger from '@cumulus/logger';

import { RetryOnDbConnectionTerminateError } from './retry';
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
  return await RetryOnDbConnectionTerminateError(query, {}, log);
};

// TODO - This function is going to be super-non-performant
// We need to identify the specific need here and see if we can optimize
export const getUniqueCollectionsByGranuleFilter = async (params: {
  startTimestamp?: string,
  endTimestamp?: string,
  collectionIds?: string[],
  granuleIds?: string[],
  providers?: string[],
  knex: Knex,
}) => {
  const { knex } = params;
  // TODO use TableNames.* instead of hardcoding table names
  const query = knex('collections')
    .distinct('collections.*')
    .innerJoin('granules', 'collections.cumulus_id', 'granules.collection_cumulus_id')
  if (params.startTimestamp) {
    query.where('granules.updated_at', '>=', params.startTimestamp);
  }
  if (params.endTimestamp) {
    query.where('granules.updated_at', '<=', params.endTimestamp);
  }

  // Filter by collectionIds
  if (params.collectionIds && params.collectionIds.length > 0) {
    const collectionNameVersionPairs = params.collectionIds.map((id) => {
      const [name, version] = id.split('___'); // TODO this is a common, trivial method )
      return { name, version };
    });

    query.whereIn(
      ['collections.name', 'collections.version'],
      collectionNameVersionPairs.map(({ name, version }) => [name, version])
    );
  }

  // Filter by granuleIds
  if (params.granuleIds && params.granuleIds.length > 0) {
    query.whereIn('granules.granule_id', params.granuleIds);
  }

  // Filter by provider names
  if (params.providers && params.providers.length > 0) {
    query.innerJoin('providers', 'granules.provider_cumulus_id', 'providers.cumulus_id');
    query.whereIn('providers.name', params.providers);
  }

  query.orderBy(['collections.name', 'collections.version']);

  console.log('query is', query.toString());
  return query;
};

import { Knex } from 'knex';
import Logger from '@cumulus/logger';

import { deconstructCollectionId } from '@cumulus/message/Collections';

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
  const collectionsTable = TableNames.collections;
  const granulesTable = TableNames.granules;
  const providersTable = TableNames.providers;

  const query = knex(collectionsTable)
    .distinct(`${collectionsTable}.*`)
    .innerJoin(granulesTable, `${collectionsTable}.cumulus_id`, `${granulesTable}.collection_cumulus_id`);

  if (params.startTimestamp) {
    query.where(`${granulesTable}.updated_at`, '>=', params.startTimestamp);
  }
  if (params.endTimestamp) {
    query.where(`${granulesTable}.updated_at`, '<=', params.endTimestamp);
  }

  // Filter by collectionIds
  if (params.collectionIds && params.collectionIds.length > 0) {
    const collectionNameVersionPairs = params.collectionIds.map((id) =>
      deconstructCollectionId(id));

    query.whereIn(
      [`${collectionsTable}.name`, `${collectionsTable}.version`],
      collectionNameVersionPairs.map(({ name, version }) => [name, version])
    );
  }

  // Filter by granuleIds
  if (params.granuleIds && params.granuleIds.length > 0) {
    query.whereIn(`${granulesTable}.granule_id`, params.granuleIds);
  }

  // Filter by provider names
  if (params.providers && params.providers.length > 0) {
    query.innerJoin(providersTable, `${granulesTable}.provider_cumulus_id`, `${providersTable}.cumulus_id`);
    query.whereIn(`${providersTable}.name`, params.providers);
  }

  query.orderBy([`${collectionsTable}.name`, `${collectionsTable}.version`]);
  return query;
};

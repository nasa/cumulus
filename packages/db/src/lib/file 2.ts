import { Knex } from 'knex';

import { deconstructCollectionId } from '@cumulus/message/Collections';

import { TableNames } from '../tables';
import { PostgresFileRecord } from '../types/file';
import { PostgresGranuleRecord } from '../types/granule';

/**
 * Helper to build a query that returns records from the files table with data
 * joined in from the granules table optionally filtered by collectionIds,
 * granulesIds and providers.
 *
 * @param {Object} params
 * @param {Knex} params.knex - Knex client object
 * @param {Partial<PostgresFileRecord>} params.searchParams
 *   Query search parameters for files table
 * @param {Array<string>} params.sortColumns
 *   Columns to sort results by
 * @param {Array<string>} [params.granuleColumns]
 *   Columns to return from granules table
 * @param {number} [params.limit] - Limit on number of results to return. Optional.
 * @param {Array<string>} [params.collectionIds] - Array of collectionIds to include.
 * @param {Array<string>} [params.granuleIds] - Array of granuleIds to include.
 * @param {Array<string>} [params.providers] - Array of providers to include.
 * @returns {Promise<Object>} - A Knex query builder object
 */
export const getFilesAndGranuleInfoQuery = ({
  knex,
  searchParams,
  sortColumns,
  granuleColumns = [],
  limit,
  collectionIds = [],
  granuleIds = [],
  providers = [],
}: {
  knex: Knex;
  searchParams: Partial<PostgresFileRecord>;
  sortColumns: (keyof PostgresFileRecord)[];
  granuleColumns?: (keyof PostgresGranuleRecord)[];
  limit?: number;
  collectionIds?: string[];
  granuleIds?: string[];
  providers?: string[];
}): Knex.QueryBuilder => {
  const {
    collections: collectionsTable,
    files: filesTable,
    granules: granulesTable,
    providers: providersTable,
  } = TableNames;
  const query = knex(filesTable)
    .select(`${filesTable}.*`)
    .modify((queryBuilder: Knex.QueryBuilder) => {
      if (granuleColumns.length > 0) {
        queryBuilder.select(
          granuleColumns.map((column) => `${granulesTable}.${column}`)
        );
        queryBuilder.innerJoin(
          granulesTable,
          `${filesTable}.granule_cumulus_id`,
          `${granulesTable}.cumulus_id`
        );
      }
    })
    .where(searchParams)
    .orderBy(sortColumns);
  if (limit) {
    query.limit(limit);
  }
  if (collectionIds.length > 0) {
    query.innerJoin(
      collectionsTable,
      `${granulesTable}.collection_cumulus_id`,
      `${collectionsTable}.cumulus_id`
    );
    const nameVersionPairs = collectionIds.map(deconstructCollectionId);
    const firstPair = nameVersionPairs.pop() as {
      name: string;
      version: string;
    };
    query.andWhere(function () {
      const innerQuery = this;
      innerQuery.where(firstPair);
      nameVersionPairs.forEach((pair) => innerQuery.orWhere(pair));
    });
  }
  if (granuleIds.length > 0) {
    query.whereIn('granule_id', granuleIds);
  }
  if (providers.length > 0) {
    query
      .innerJoin(
        providersTable,
        `${granulesTable}.provider_cumulus_id`,
        `${providersTable}.cumulus_id`
      )
      .whereIn(`${providersTable}.name`, providers);
  }
  return query;
};

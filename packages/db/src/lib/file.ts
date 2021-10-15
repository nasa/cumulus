import { Knex } from 'Knex';

import { TableNames } from '../tables';
import { PostgresFileRecord } from '../types/file';
import { PostgresGranuleRecord } from '../types/granule';

/**
 * Helper to build a query that returns records from the files table
 * with data joined in from the granules table.
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
 * @returns {Promise<Object>} - A Knex query builder object
 */
export const getFilesAndGranuleInfoQuery = ({
  knex,
  searchParams,
  sortColumns,
  limit,
  granuleColumns = [],
}: {
  knex: Knex,
  searchParams: Partial<PostgresFileRecord>,
  sortColumns: (keyof PostgresFileRecord)[],
  granuleColumns?: (keyof PostgresGranuleRecord)[],
  limit?: number
}): Knex.QueryBuilder => {
  const query = knex(TableNames.files)
    .select(`${TableNames.files}.*`)
    .modify((queryBuilder: Knex.QueryBuilder) => {
      if (granuleColumns.length > 0) {
        queryBuilder.select(granuleColumns.map((column) => `${TableNames.granules}.${column}`));
        queryBuilder.innerJoin(
          TableNames.granules,
          `${TableNames.files}.granule_cumulus_id`,
          `${TableNames.granules}.cumulus_id`
        );
      }
    })
    .where(searchParams)
    .orderBy(sortColumns);
  if (limit) {
    query.limit(limit);
  }
  return query;
};

import Knex from 'Knex';

import { tableNames } from '../tables';
import { PostgresFileRecord } from '../types/file';
import { PostgresGranuleRecord } from '../types/granule';

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
  granuleColumns: (keyof PostgresGranuleRecord)[],
  limit?: number
}) => {
  const query = knex(tableNames.files)
    .select(`${tableNames.files}.*`)
    .select(granuleColumns.map((column) => `${tableNames.granules}.${column}`))
    .join(
      tableNames.granules,
      `${tableNames.files}.granule_cumulus_id`,
      '=',
      `${tableNames.granules}.cumulus_id`
    )
    .where(searchParams)
    .orderBy(sortColumns);
  if (limit) {
    query.limit(limit);
  }
  return query;
};

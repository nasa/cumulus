import Knex from 'Knex';

import { tableNames } from '../tables';
import { PostgresFileRecord } from '../types/file';

// TODO: make suport an array of desired granule columns
export const getFilesAndGranuleIdQuery = ({
  knex,
  searchParams,
  sortColumns,
  limit,
}: {
  knex: Knex,
  searchParams: Partial<PostgresFileRecord>,
  sortColumns: (keyof PostgresFileRecord)[]
  limit?: number
}) => {
  const query = knex(tableNames.files)
    .select(`${tableNames.files}.*`, `${tableNames.granules}.granule_id`)
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

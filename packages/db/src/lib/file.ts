import Knex from 'Knex';

import { tableNames } from '../tables';
import { PostgresFileRecord } from '../types/file';

export const getFilesAndGranuleIdQuery = ({
  knex,
  searchParams,
  sortColumns,
  limit = 10,
}: {
  knex: Knex,
  searchParams: Partial<PostgresFileRecord>,
  sortColumns: (keyof PostgresFileRecord)[]
  limit: number
}) =>
  knex(tableNames.files)
    .select(`${tableNames.files}.*`, `${tableNames.granules}.granule_id`)
    .join(
      tableNames.granules,
      `${tableNames.files}.granule_cumulus_id`,
      '=',
      `${tableNames.granules}.cumulus_id`
    )
    .where(searchParams)
    .orderBy(sortColumns)
    .limit(limit);

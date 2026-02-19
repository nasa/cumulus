import { DuckDBValue, DuckDBConnection } from '@duckdb/node-api';
import { knex, Knex } from 'knex';
import Logger from '@cumulus/logger';
import { TableNames } from '../tables';
import { PostgresFileRecord } from '../types/file';

const log = new Logger({ sender: '@cumulus/db/duckdbHelpers' });

export function prepareBindings(bindings: ReadonlyArray<any>): DuckDBValue[] {
  return bindings.map((value) => {
    if (value instanceof Date) return value.toISOString();
    if (value !== null && typeof value === 'object') return JSON.stringify(value);
    return value as DuckDBValue;
  });
}

/**
 * Returns execution records sorted by most recent first for an input
 * set of Granule Cumulus IDs.
 *
 * @param {object} params - The function parameters.
 * @param {DuckDBConnection} params.connection - The active DuckDB connection.
 * @param {number[]} params.granuleCumulusIds - Array of granule IDs to filter by.
 * @param {Knex} [params.knexBuilder] - Optional Knex instance (defaults to 'pg' client).
 * @param {number} [params.limit] - Optional limit for the number of records returned.
 * @returns {Promise<{ granule_cumulus_id: number, url: string }[]>}
 *   Array of objects containing granule_cumulus_id and execution url, sorted by timestamp desc.
 */
export const getExecutionInfoByGranuleCumulusIds = async ({
  connection,
  granuleCumulusIds,
  knexBuilder = knex({ client: 'pg' }),
  limit,
}: {
  connection: DuckDBConnection,
  granuleCumulusIds: number[],
  knexBuilder: Knex,
  limit?: number
}): Promise<{ granule_cumulus_id: number, url: string }[]> => {
  const knexQuery = knexBuilder(TableNames.executions)
    .select([
      `${TableNames.executions}.url`,
      `${TableNames.granulesExecutions}.granule_cumulus_id`,
    ])
    .join(
      TableNames.granulesExecutions,
      `${TableNames.executions}.cumulus_id`,
      `${TableNames.granulesExecutions}.execution_cumulus_id`
    )
    .whereIn(`${TableNames.granulesExecutions}.granule_cumulus_id`, granuleCumulusIds)
    .orderBy(`${TableNames.executions}.timestamp`, 'desc');

  if (limit) knexQuery.limit(limit);

  const { sql, bindings } = knexQuery.toSQL().toNative();
  log.debug(`getExecutionInfoByGranuleCumulusIds query: ${sql}`);

  // Use spread operator to convert ReadonlyArray to mutable array
  const reader = await connection.runAndReadAll(
    sql,
    prepareBindings([...bindings])
  );

  return reader.getRowObjectsJson() as any[] as { granule_cumulus_id: number, url: string }[];
};

/**
 * Searches for file records by granule cumulus IDs using a DuckDB connection.
 *
 * @param params - Function parameters
 * @param params.connection - Active DuckDB connection used to execute the query
 * @param params.granuleCumulusIds - Array of granule Cumulus IDs to filter by
 * @param [params.columns='*'] - Columns to select (string or string array)
 * @param [params.knexBuilder] - Optional Knex instance (defaults to PostgreSQL dialect)
 * @returns Promise resolving to an array of normalized `PostgresFileRecord` objects
 * @throws If the DuckDB query execution fails
 */
export const getFilesByGranuleCumulusIds = async ({
  connection,
  granuleCumulusIds,
  columns = '*',
  knexBuilder = knex({ client: 'pg' }),
}: {
  connection: DuckDBConnection;
  granuleCumulusIds: number[];
  columns?: string | string[];
  knexBuilder?: Knex;
}): Promise<PostgresFileRecord[]> => {
  const knexQuery = knexBuilder(TableNames.files)
    .select(columns)
    .whereIn('granule_cumulus_id', granuleCumulusIds);

  const { sql, bindings } = knexQuery.toSQL().toNative();

  // Execute using DuckDB connection
  const reader = await connection.runAndReadAll(
    sql,
    prepareBindings([...bindings]) // prepareBindings must be imported/defined in scope
  );

  const rows = reader.getRowObjectsJson();

  // Mapping resolves TS errors and handles DuckDB type conversions
  return rows.map((row) => ({
    ...row,
    // Ensure IDs are numbers (handles DuckDB BigInt/String return types)
    cumulus_id: Number(row.cumulus_id),
    granule_cumulus_id: Number(row.granule_cumulus_id),
    // Convert ISO timestamp strings back to JS Date objects
    created_at: row.created_at ? new Date(row.created_at as string) : undefined,
    updated_at: row.updated_at ? new Date(row.updated_at as string) : undefined,
  })) as any[] as PostgresFileRecord[];
};

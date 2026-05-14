import { knex, Knex } from 'knex';
import { DuckDBConnection } from '@duckdb/node-api';
import Logger from '@cumulus/logger';

import { prepareBindings } from './duckdbHelpers';
import { Meta } from '../search/BaseSearch';
import { DbQueryParameters } from '../types/search';
import {
  acquireDuckDbConnection,
  releaseDuckDbConnection,
  forceSecretRefresh,
  rebuildDuckDbConnectionPool,
} from '../iceberg-connection';

const log = new Logger({ sender: '@cumulus/db/DuckDBSearchExecutor' });

/**
 * Returns true when the error is a recoverable DuckDB catalog-related miss,
 * including missing-table Catalog errors and Binder missing-catalog errors
 * observed during transient catalog re-attachment windows.
 *
 * @param error - value to evaluate
 * @returns true when the error matches a recoverable catalog miss pattern
 */
export function isCatalogError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const missingTableCatalogPattern
    = /^catalog error:\s*table with name\s+["']?[\w.-]+["']?\s+does not exist!/i;
  const missingCatalogBinderPattern
    = /^binder error:\s*catalog\s+["']?[\w.-]+["']?\s+does not exist!/i;

  return (
    missingTableCatalogPattern.test(error.message)
    || missingCatalogBinderPattern.test(error.message)
  );
}

/**
 * Returns true for recoverable S3/HTTP data-access failures that can be fixed
 * by rebuilding a stale DuckDB connection and retrying once.
 *
 * @param error - value to evaluate
 * @returns true when the error matches S3 parquet HTTP 400 access failure
 */
export function isRecoverableS3HttpError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message;
  const s3Http400Pattern = new RegExp(
    [
      'http get error on \'https?:\\/\\/[^\']*\\.s3\\.[^\']*amazonaws\\.com\\/[^\']*\\.(parquet|avro|json)\'',
      ' \\(http 400\\)',
    ].join(''),
    'i'
  );
  return s3Http400Pattern.test(message);
}

/**
 * Shared helper that builds queries, acquires a DuckDB connection, executes,
 * and releases the connection when done.
 *
 * @param params - execute options
 * @param params.dbQueryParameters - query parameters controlling pagination, count, etc.
 * @param params.getMetaTemplate - returns the response meta template
 * @param params.makeTranslateRecords - factory called with the resolved connection,
 *   returns the record-translation function.  Simple classes can ignore the connection
 *   argument; classes that need it (e.g. GranuleIcebergSearch) can close over it.
 * @param params.buildSearch - builds the knex count/search queries
 */
export async function executeDuckDBSearch(params: {
  dbQueryParameters: DbQueryParameters;
  getMetaTemplate: () => Meta;
  makeTranslateRecords: (
    conn: DuckDBConnection
  ) => (records: any[], knexClient: Knex) => any[] | Promise<any[]>;
  buildSearch: (knexBuilder: Knex) => {
    countQuery?: Knex.QueryBuilder;
    searchQuery: Knex.QueryBuilder;
  };
}) {
  const {
    dbQueryParameters, getMetaTemplate, makeTranslateRecords, buildSearch,
  } = params;

  // Use pg dialect to generate DuckDB-compatible SQL ($1, $2, etc.)
  const knexBuilder = knex({ client: 'pg' });
  const { countQuery, searchQuery } = buildSearch(knexBuilder);
  const shouldReturnCountOnly = dbQueryParameters.countOnly === true;

  const queryConfigs = shouldReturnCountOnly
    ? [{ key: 'count', query: countQuery }]
    : [
      { key: 'count', query: countQuery },
      { key: 'records', query: searchQuery },
    ];

  // 1. Construct and compile all SQL queries BEFORE acquiring the connection
  // DuckDB cannot handle multiple prepared statements simultaneously, but we can
  // evaluate the knex AST to SQL safely up front.
  const nativeQueries = queryConfigs
    .filter((c) => c.query)
    .map((config) => {
      const { sql, bindings } = config.query!.clone().toSQL().toNative();
      return { key: config.key, sql, bindings };
    });

  let pooledConnection: DuckDBConnection = await acquireDuckDbConnection();

  try {
    let countResult: any[] = [];
    let records: any[] = [];

    // 2. Local helper to execute the native SQL strings sequentially
    const runNativeQueries = async (connection: DuckDBConnection) => {
      for (const nativeQuery of nativeQueries) {
        log.debug(`Executing SQL: ${nativeQuery.sql}`);
        const queryStart = Date.now();
        // eslint-disable-next-line no-await-in-loop
        const reader = await connection.runAndReadAll(
          nativeQuery.sql,
          prepareBindings(nativeQuery.bindings)
        );
        log.debug(`Query "${nativeQuery.key}" completed in ${Date.now() - queryStart}ms`);

        const result = reader.getRowObjectsJson();
        if (nativeQuery.key === 'count') countResult = result;
        else records = result;
      }
    };

    try {
      await runNativeQueries(pooledConnection);
    } catch (error) {
      const hasRecoverableCatalogError = isCatalogError(error);
      const hasRecoverableS3Error = isRecoverableS3HttpError(error);

      if (!hasRecoverableCatalogError && !hasRecoverableS3Error) {
        throw error;
      }

      log.warn('Recoverable DuckDB query error detected; retrying once with a fresh connection.', error);
      forceSecretRefresh();

      if (hasRecoverableS3Error) {
        log.warn(
          'Recoverable S3 HTTP error detected. Rebuilding DuckDB connection pool before retry.'
        );
      }

      await releaseDuckDbConnection(pooledConnection);
      if (hasRecoverableS3Error) {
        await rebuildDuckDbConnectionPool();
      }

      pooledConnection = await acquireDuckDbConnection();
      await runNativeQueries(pooledConnection);
      log.info(
        hasRecoverableS3Error
          ? 'DuckDB query retry succeeded after pool rebuild.'
          : 'DuckDB query retry succeeded after connection refresh.'
      );
    }

    // 3. Post-process resulting data
    const meta = getMetaTemplate();
    meta.limit = dbQueryParameters.limit;
    meta.page = dbQueryParameters.page;
    meta.count = Number(countResult[0]?.count ?? 0);

    const translateRecords = makeTranslateRecords(pooledConnection);
    const apiRecords = await translateRecords(records, knexBuilder);

    return { meta, results: apiRecords };
  } finally {
    await releaseDuckDbConnection(pooledConnection);
  }
}
